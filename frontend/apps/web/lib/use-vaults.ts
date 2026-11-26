'use client';
import {useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useAccount, usePublicClient, useWalletClient} from 'wagmi';
import {erc20Abi, getAddress, type Address, type Hash} from 'viem';
import {factoryAbi, floorOutput, listVaults, loadDeployment, vaultAbi, vaultChain, vaultEvent, vaultSnapshot, type Deployment} from './vaults';

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
  | {kind:'create';basket:Basket;seed:bigint;outputs:readonly bigint[]}
  | {kind:'deposit';vault:Address;amount:bigint;shares:bigint;outputs:readonly bigint[]}
  | {kind:'redeem';vault:Address;amount:bigint;net:bigint};
export function useVaultTransaction(d?:Deployment) {
  const account=useAccount(), client=usePublicClient({chainId:d?.chainId??vaultChain.id}), wallet=useWalletClient();
  const cache=useQueryClient();
  const [pending,setPending]=useState(''),[error,setError]=useState(''),[lastHash,setLastHash]=useState<Hash>();
  const ready=!!d&&!!client&&!!wallet.data && !!account.address && account.chainId===d.chainId;
  async function submit(action:VaultAction,slip:number) {
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
    setError('');setLastHash(undefined);setPending('Checking wallet');
    try {
      await checkWallet();
      const target=action.kind==='create'?deployment.factory:action.vault;
      if(action.kind!=='redeem') {
        const spend=action.kind==='create'?action.seed:action.amount;
        const token={address:deployment.settlementToken,abi:erc20Abi} as const;
        const [allowance,balance]=await Promise.all([
          publicClient.readContract({...token,functionName:'allowance',args:[holder,target]}),
          publicClient.readContract({...token,functionName:'balanceOf',args:[holder]}),
        ]);
        if(balance<spend) throw Error('Insufficient USDT balance');
        if(allowance<spend) {
          setPending('Approve USDT in your wallet');
          const simulation=await publicClient.simulateContract({...token,account:holder,functionName:'approve',args:[target,spend]});
          await checkWallet();
          await confirm(await signer.writeContract(simulation.request));
        }
      }
      setPending('Confirm vault transaction');
      const deadline=(await publicClient.getBlock()).timestamp+600n;
      const minimum=(x:bigint)=>floorOutput(x,slip);
      await checkWallet();
      let hash:Hash;
      if(action.kind==='create') {
        const simulation=await publicClient.simulateContract({address:deployment.factory,abi:factoryAbi,account:holder,functionName:'createVault',args:[action.basket,action.seed,action.outputs.map(minimum),deadline,'0x']});
        hash=await signer.writeContract(simulation.request);
      } else if(action.kind==='deposit') {
        const simulation=await publicClient.simulateContract({address:target,abi:vaultAbi,account:holder,functionName:'deposit',args:[action.amount,minimum(action.shares),action.outputs.map(minimum),deadline]});
        hash=await signer.writeContract(simulation.request);
      } else {
        const simulation=await publicClient.simulateContract({address:target,abi:vaultAbi,account:holder,functionName:'redeem',args:[action.amount,minimum(action.net),deadline]});
        hash=await signer.writeContract(simulation.request);
      }
      const receipt=await confirm(hash);
      const event=vaultEvent(receipt,getAddress(target));
      await cache.invalidateQueries({queryKey:['vaults',deployment.factory]});
      return event;
    } catch(err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Wallet transaction failed');
      return undefined;
    } finally { setPending(''); }
  }
  return {ready,submit,pending,error,lastHash};
}
