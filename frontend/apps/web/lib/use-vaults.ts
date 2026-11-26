'use client';
import {useRef,useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useAccount, usePublicClient, useWalletClient} from 'wagmi';
import {erc20Abi, getAddress, type Address, type Hash} from 'viem';
import {authorizeLaunch, factoryAbi, floorOutput, legMinimums, listVaults, loadDeployment, vaultAbi, vaultChain, vaultEvent, vaultSnapshot, routerAbi, type Deployment} from './vaults';

export function useDeployment() {
  const client=usePublicClient({chainId:vaultChain.id});
  const query=useQuery({queryKey:['deployment',vaultChain.id],enabled:!!client,
    queryFn:({signal})=>loadDeployment(client!,signal),staleTime:60000});
  return {client,...query};
}
export function useDirectory(d?:Deployment) {
  const client=usePublicClient({chainId:d?.chainId??vaultChain.id});
  return useQuery({queryKey:['vaults',d?.factory??'unavailable','directory'],enabled:!!d&&!!client,queryFn:()=>listVaults(client!,d!),refetchInterval:15000});
}
export function useVault(d:Deployment|undefined,address:Address|undefined) {
  const client=usePublicClient({chainId:d?.chainId??vaultChain.id});
  const {address:holder}=useAccount();
  return useQuery({queryKey:['vaults',d?.factory??'unavailable','snapshot',address??'unavailable',holder??'public'],enabled:!!d&&!!address&&!!client,queryFn:()=>vaultSnapshot(client!,d!,address!,holder),refetchInterval:10000});
}
export type Basket = {name:string;symbol:string;metadataURI:string;constituents:{token:Address;weightBps:number}[]};
export type VaultAction =
  | {kind:'create';basket:Basket;seed:bigint;liquidity:bigint;creatorShares:bigint;outputs:readonly bigint[]}
  | {kind:'deposit';vault:Address;amount:bigint;shares:bigint;outputs:readonly bigint[]}
  | {kind:'redeem';vault:Address;token:Address;amount:bigint;net:bigint;legs:readonly bigint[]}
  | {kind:'redeemInKind';vault:Address;token:Address;amount:bigint;net:readonly bigint[]}
  | {kind:'swap';token:Address;buy:boolean;amount:bigint;out:bigint}
  | {kind:'addLiquidity';token:Address;cash:bigint;shares:bigint}
  | {kind:'removeLiquidity';token:Address;pair:Address;amount:bigint;cash:bigint;shares:bigint};
export function useVaultTransaction(d?:Deployment) {
  const account=useAccount(), client=usePublicClient({chainId:d?.chainId??vaultChain.id}), wallet=useWalletClient();
  const cache=useQueryClient();
  const [pending,setPending]=useState(''),[error,setError]=useState(''),[lastHash,setLastHash]=useState<Hash>();
  const inFlight=useRef(false);
  const ready=!!d&&!!client&&!!wallet.data && !!account.address && account.chainId===d.chainId;
  async function submit(action:VaultAction,slip:number) {
    if(inFlight.current)return;
    if(!ready || !d || !client || !wallet.data || !account.address) { setError('Connect a wallet on the deployment network'); return; }
    const signer=wallet.data, holder=account.address, deployment=d, publicClient=client;
    async function checkWallet() {
      const [chain,accounts]=await Promise.all([signer.getChainId(),signer.getAddresses()]);
      if(chain!==deployment.chainId || accounts[0]?.toLowerCase()!==holder.toLowerCase()) throw Error('Wallet account or chain changed. Review the transaction again.');
    }
    async function confirm(hash:Hash) {
      setLastHash(hash);
      const receipt=await publicClient.waitForTransactionReceipt({hash});
      if(receipt.status!=='success') throw Error('Transaction reverted');
      return receipt;
    }
    inFlight.current=true;
    setError('');setLastHash(undefined);setPending('Checking wallet');
    try {
      await checkWallet();
      const minimum=(x:bigint)=>floorOutput(x,slip);
      async function approve(asset:Address,target:Address,spend:bigint,label:string){
        const token={address:asset,abi:erc20Abi} as const;
        const [allowance,balance]=await Promise.all([
          publicClient.readContract({...token,functionName:'allowance',args:[holder,target]}),
          publicClient.readContract({...token,functionName:'balanceOf',args:[holder]}),
        ]);
        if(balance<spend) throw Error(`Insufficient ${label} balance`);
        if(allowance<spend) {
          setPending(`Approve ${label} in your wallet`);
          const simulation=await publicClient.simulateContract({...token,account:holder,functionName:'approve',args:[target,spend]});
          await checkWallet();await confirm(await signer.writeContract(simulation.request));
        }
      }
      const cash=deployment.settlementToken, router=deployment.router;
      if(action.kind==='create'){
        if(!deployment.fixture)throw Error('Public launch authorization is not configured. Creation is disabled on this deployment.');
        await approve(cash,deployment.factory,action.seed+action.liquidity,'USDT');
      }else if(action.kind==='deposit')await approve(cash,action.vault,action.amount,'USDT');
      else if(action.kind==='redeem'||action.kind==='redeemInKind')await approve(action.token,action.vault,action.amount,'portfolio token');
      else if(action.kind==='swap')await approve(action.buy?cash:action.token,router,action.amount,action.buy?'USDT':'portfolio token');
      else if(action.kind==='addLiquidity'){
        await approve(cash,router,action.cash,'USDT');await approve(action.token,router,action.shares,'portfolio token');
      }else await approve(action.pair,router,action.amount,'LP token');
      setPending('Confirm transaction');
      const deadline=(await publicClient.getBlock()).timestamp+600n;
      await checkWallet();
      let hash:Hash;
      let eventSource:Address|undefined;
      if(action.kind==='create') {
        eventSource=deployment.factory;
        const factory=eventSource;
        // A used or expired request ID is recoverable: obtain a fresh authorization and retry.
        let request;
        for(let attempt=0;;attempt++){
          const auth=await authorizeLaunch(deployment);
          if(await publicClient.readContract({address:factory,abi:factoryAbi,functionName:'usedRequestIds',args:[auth.requestId]})){if(attempt<2)continue;throw Error('Launch request ID already used. Try again.');}
          try{
            request=(await publicClient.simulateContract({address:factory,abi:factoryAbi,account:holder,functionName:'createVault',args:[auth.requestId,action.basket,action.seed,action.liquidity,minimum(action.creatorShares),action.outputs.map(minimum),deadline,auth.authorization]})).request;
            break;
          }catch(err){if(attempt<2&&err instanceof Error&&/request id/i.test(err.message))continue;throw err;}
        }
        await checkWallet();hash=await signer.writeContract(request);
      } else if(action.kind==='deposit') {
        eventSource=action.vault;
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'deposit',args:[action.amount,minimum(action.shares),action.outputs.map(minimum),deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      } else if(action.kind==='redeem') {
        eventSource=action.vault;
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'redeem',args:[action.amount,minimum(action.net),legMinimums(action.legs,slip),deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      } else if(action.kind==='redeemInKind') {
        eventSource=action.vault;
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'redeemInKind',args:[action.amount,legMinimums(action.net,slip),deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      } else if(action.kind==='swap') {
        const path=action.buy?[cash,action.token]:[action.token,cash];
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'swapExactTokensForTokens',args:[action.amount,minimum(action.out),path,holder,deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      } else if(action.kind==='addLiquidity') {
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'addLiquidity',args:[cash,action.token,action.cash,action.shares,minimum(action.cash),minimum(action.shares),holder,deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      } else {
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'removeLiquidity',args:[cash,action.token,action.amount,minimum(action.cash),minimum(action.shares),holder,deadline]});
        await checkWallet();hash=await signer.writeContract(simulation.request);
      }
      const receipt=await confirm(hash);
      const event=eventSource?vaultEvent(receipt,getAddress(eventSource)):undefined;
      await cache.invalidateQueries({queryKey:['vaults',deployment.factory]});
      return {event,receipt};
    } catch(err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Wallet transaction failed');
      return undefined;
    } finally { inFlight.current=false;setPending(''); }
  }
  return {ready,submit,pending,error,lastHash};
}
