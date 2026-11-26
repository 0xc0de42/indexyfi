'use client';
import {useRef,useState} from 'react';
import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query';
import {useAccount, usePublicClient, useWalletClient} from 'wagmi';
import {erc20Abi, getAddress, type Address, type Hash} from 'viem';
import {authorizeLaunch, launchDigest, launchSigner, newRequestId, factoryAbi, feedIdsFor, floorOutput, gasLimit, legMinimums, listVaults, loadDeployment, signedPrices, vaultAbi, vaultChain, vaultEvent, vaultSnapshot, routerAbi, type Deployment, type GasKind} from './vaults';

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
/** Whether the connected wallet may launch: always on the local fixture; on public chains only OpenFour Core's signer. */
export function useCanLaunch(d?:Deployment){
  const client=usePublicClient({chainId:d?.chainId??vaultChain.id});
  const {address}=useAccount();
  const signer=useQuery({queryKey:['launch-signer',d?.openfour?.core??'none'],enabled:!!d&&!d.fixture&&!!client,queryFn:()=>launchSigner(client!,d!),staleTime:60_000});
  if(!d) return {canLaunch:false,signer:undefined};
  if(d.fixture) return {canLaunch:true,signer:undefined};
  return {canLaunch:!!address&&!!signer.data&&signer.data.toLowerCase()===address.toLowerCase(),signer:signer.data??undefined};
}
/** Every vault of the deployment with its on-chain snapshot, newest first. */
export function useVaults(d?:Deployment) {
  const client=usePublicClient({chainId:d?.chainId??vaultChain.id});
  const {address:holder}=useAccount();
  const directory=useDirectory(d);
  const hidden=new Set((d?.hiddenVaults??[]).map(a=>a.toLowerCase()));
  const addresses=[...(directory.data??[])].reverse().filter(a=>!hidden.has(a.toLowerCase()));
  const snapshots=useQueries({queries:addresses.map(address=>({
    queryKey:['vaults',d?.factory??'unavailable','snapshot',address,holder??'public'],
    enabled:!!d&&!!client,queryFn:()=>vaultSnapshot(client!,d!,address,holder),refetchInterval:10000,
  }))});
  return {
    isLoading:directory.isLoading||snapshots.some(s=>s.isLoading),
    isError:directory.isError,
    vaults:snapshots.flatMap(s=>s.data?[s.data]:[]),
  };
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
      // Every vault write carries an explicit gas limit (see gasLimit): wallets would otherwise re-estimate, and Hardhat's
      // estimator fails for launches of 9+ assets although they execute well under the per-transaction cap.
      // Latest Atlas-signed prices travel inside the launch / deposit / redeem transaction (*WithPrices), fetched
      // right before simulation so the oracle is updated and used atomically. None on the local fixture.
      async function pricesForVault(vault:Address){
        const legs=await publicClient.readContract({address:vault,abi:vaultAbi,functionName:'constituents'});
        setPending('Fetching latest signed prices');
        return signedPrices(deployment,feedIdsFor(deployment,legs.map(l=>l.token)));
      }
      async function withGas<R extends object>(request:R,kind:GasKind,legs:number):Promise<R & {gas:bigint}> {
        // A simulation request carries the same fields estimateContractGas reads; viem's types just don't line them up.
        const estimate=await publicClient.estimateContractGas(request as unknown as Parameters<typeof publicClient.estimateContractGas>[0]).catch(()=>undefined);
        return {...request,gas:gasLimit(kind,legs,estimate)};
      }
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
        if(!deployment.fixture){
          const launcher=await launchSigner(publicClient,deployment);
          if(!launcher||launcher.toLowerCase()!==holder.toLowerCase()) throw Error('Only the OpenFour launch signer (the IndexFi operator wallet) can launch on this network.');
        }
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
        setPending('Fetching latest signed prices');
        const prices=await signedPrices(deployment,feedIdsFor(deployment,action.basket.constituents.map(c=>c.token)));
        const minCreator=minimum(action.creatorShares),minimums=action.outputs.map(minimum);
        for(let attempt=0;;attempt++){
          let auth;
          if(deployment.fixture) auth=await authorizeLaunch(deployment);
          else {
            // Public chain: the connected wallet is Core.signer (checked above) and signs the OpenFour launch digest.
            const requestId=newRequestId();
            const createArgs=await publicClient.readContract({address:factory,abi:factoryAbi,functionName:'buildCreateArgs',args:[requestId,holder,action.basket,action.seed,action.liquidity,minCreator,minimums,deadline,0n]});
            setPending('Sign the OpenFour launch authorization in your wallet');
            await checkWallet();
            auth={requestId,authorization:await signer.signMessage({account:holder,message:{raw:launchDigest(deployment.chainId,factory,createArgs)}})};
            setPending('Confirm transaction');
          }
          if(await publicClient.readContract({address:factory,abi:factoryAbi,functionName:'usedRequestIds',args:[auth.requestId]})){if(attempt<2)continue;throw Error('Launch request ID already used. Try again.');}
          try{
            request=(await publicClient.simulateContract({address:factory,abi:factoryAbi,account:holder,functionName:'createVaultWithPrices',args:[prices.payloads,prices.signatures,auth.requestId,action.basket,action.seed,action.liquidity,minCreator,minimums,deadline,auth.authorization]})).request;
            break;
          }catch(err){if(attempt<2&&err instanceof Error&&/request id/i.test(err.message))continue;throw err;}
        }
        const sized=await withGas(request,'create',action.basket.constituents.length);
        await checkWallet();hash=await signer.writeContract(sized);
      } else if(action.kind==='deposit') {
        eventSource=action.vault;
        const prices=await pricesForVault(action.vault);
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'depositWithPrices',args:[prices.payloads,prices.signatures,action.amount,minimum(action.shares),action.outputs.map(minimum),deadline]});
        const sized=await withGas(simulation.request,'deposit',action.outputs.length);
        await checkWallet();hash=await signer.writeContract(sized);
      } else if(action.kind==='redeem') {
        eventSource=action.vault;
        const prices=await pricesForVault(action.vault);
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'redeemWithPrices',args:[prices.payloads,prices.signatures,action.amount,minimum(action.net),legMinimums(action.legs,slip),deadline]});
        const sized=await withGas(simulation.request,'redeem',action.legs.length);
        await checkWallet();hash=await signer.writeContract(sized);
      } else if(action.kind==='redeemInKind') {
        eventSource=action.vault;
        const prices=await pricesForVault(action.vault);
        const simulation=await publicClient.simulateContract({address:action.vault,abi:vaultAbi,account:holder,functionName:'redeemInKindWithPrices',args:[prices.payloads,prices.signatures,action.amount,legMinimums(action.net,slip),deadline]});
        const sized=await withGas(simulation.request,'redeemInKind',action.net.length);
        await checkWallet();hash=await signer.writeContract(sized);
      } else if(action.kind==='swap') {
        const path=action.buy?[cash,action.token]:[action.token,cash];
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'swapExactTokensForTokens',args:[action.amount,minimum(action.out),path,holder,deadline]});
        const sized=await withGas(simulation.request,'swap',0);
        await checkWallet();hash=await signer.writeContract(sized);
      } else if(action.kind==='addLiquidity') {
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'addLiquidity',args:[cash,action.token,action.cash,action.shares,minimum(action.cash),minimum(action.shares),holder,deadline]});
        const sized=await withGas(simulation.request,'addLiquidity',0);
        await checkWallet();hash=await signer.writeContract(sized);
      } else {
        const simulation=await publicClient.simulateContract({address:router,abi:routerAbi,account:holder,functionName:'removeLiquidity',args:[cash,action.token,action.amount,minimum(action.cash),minimum(action.shares),holder,deadline]});
        const sized=await withGas(simulation.request,'removeLiquidity',0);
        await checkWallet();hash=await signer.writeContract(sized);
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
