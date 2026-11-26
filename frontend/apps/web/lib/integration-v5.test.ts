import {describe,expect,it} from 'vitest';
import {createPublicClient,createWalletClient,http,erc20Abi,type Address,type Hash} from 'viem';
import {hardhat} from 'viem/chains';
import {createApiClient} from './api';
import {parseDeployment,quoteCreate,factoryAbi,vaultAbi,routerAbi,vaultEvent,vaultSnapshot,floorOutput,lpAmounts,listVaults,legMinimums,newRequestId} from './vaults';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Opt-in only. Uses unlocked accounts on a disposable local Hardhat node.
// The same frontend ABI/quote helpers are exercised against deployed V5 code;
// the backend is read via the real same-origin Next.js proxy.
describe.skipIf(process.env.INDEXFI_V5_SMOKE!=='1')('V5 three-service integration',()=>{
  it('launches, values, deposits, transfers, trades, manages LP, and redeems',async()=>{
    const manifest=parseDeployment(JSON.parse(readFileSync(join(__dirname,'../public/deployments/31337.json'),'utf8')),31337);
    const rpc=process.env.NEXT_PUBLIC_VAULT_RPC_URL??'http://127.0.0.1:8545';
    const url=new URL(rpc);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Local RPC required');
    const client=createPublicClient({chain:hardhat,transport:http(rpc)});
    expect(await client.getChainId()).toBe(31337);
    const accounts=await createWalletClient({chain:hardhat,transport:http(rpc)}).getAddresses();
    const creator=accounts[1],investor=accounts[2];
    if(!creator||!investor)throw Error('Fixture accounts unavailable');
    const wallet=(account:Address)=>createWalletClient({account,chain:hardhat,transport:http(rpc)});
    const c=wallet(creator),i=wallet(investor);
    const confirm=async(hash:Hash)=>{const r=await client.waitForTransactionReceipt({hash});expect(r.status).toBe('success');return r;};
    const cash=manifest.settlementToken, scale=10n**BigInt(manifest.settlementDecimals), router=manifest.router;
    const approve=async(w:typeof c,token:Address,target:Address,amount:bigint)=>confirm(await w.writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[target,amount]}));
    const deadline=async()=>(await client.getBlock()).timestamp+600n;
    const min=(n:bigint)=>floorOutput(n,100);
    const api=createApiClient({baseUrl:process.env.INDEXFI_PROXY_URL??'http://127.0.0.1:3000/backend'});
    const prices=await api.snapshot();if(!prices.ok)throw Error(`Backend snapshot unavailable: ${JSON.stringify(prices.error)}`);
    for(const a of manifest.assets)expect(prices.value.prices.some(p=>p.assetId===a.referenceAssetId&&p.feedId===a.feedId)).toBe(true);
    const end=new Date();expect((await api.history({start:new Date(end.getTime()-3600000),end})).ok).toBe(true);
    const basket={name:'Integration V5',symbol:'IV5',metadataURI:'',constituents:manifest.assets.slice(0,2).map(a=>({token:a.address,weightBps:5000}))};
    expect(basket.constituents.length).toBe(2);
    const seed=100n*scale,liq=10n*scale;
    const q=await quoteCreate(client,manifest,basket,seed,liq);
    await approve(c,cash,manifest.factory,seed+liq);
    const requestId=newRequestId();
    expect(await client.readContract({address:manifest.factory,abi:factoryAbi,functionName:'usedRequestIds',args:[requestId]})).toBe(false);
    const createArgs=async()=>[requestId,basket,seed,liq,min(q.creatorShares),q.outputs.map(min),await deadline(),'0x'] as const;
    const receipt=await confirm(await c.writeContract({address:manifest.factory,abi:factoryAbi,functionName:'createVault',args:await createArgs()}));
    const created=vaultEvent(receipt,manifest.factory);if(created.eventName!=='VaultCreated')throw Error('Missing launch event');
    const vault=created.args.vault;expect(created.args.requestId).toBe(requestId);
    expect(await listVaults(client,manifest)).toContain(vault);
    expect(await client.readContract({address:manifest.factory,abi:factoryAbi,functionName:'isVault',args:[vault]})).toBe(true);
    expect(await client.readContract({address:manifest.factory,abi:factoryAbi,functionName:'isVault',args:[investor]})).toBe(false);
    // Replaying a consumed request ID is rejected before any funds move.
    await approve(c,cash,manifest.factory,seed+liq);
    await expect(client.simulateContract({account:creator,address:manifest.factory,abi:factoryAbi,functionName:'createVault',args:await createArgs()})).rejects.toThrow(/request id/i);
    const opening=await vaultSnapshot(client,manifest,vault,creator);
    expect(opening.nav).toBe(10n**18n);expect(opening.phase).toBe(3);expect(opening.pool?.cash).toBe(liq);expect(opening.pool?.lpBalance??0n).toBeGreaterThan(0n);
    const token=opening.token;
    const input=20n*scale;
    const [issued,outs]=await client.readContract({address:vault,abi:vaultAbi,functionName:'previewDeposit',args:[input]});
    await approve(i,cash,vault,input);
    await confirm(await i.writeContract({address:vault,abi:vaultAbi,functionName:'deposit',args:[input,min(issued),outs.map(min),await deadline()]}));
    const deposited=await vaultSnapshot(client,manifest,vault,investor);expect(deposited.shares).toBeGreaterThan(0n);expect(deposited.supply).toBeGreaterThan(opening.supply);
    await confirm(await c.writeContract({address:token,abi:erc20Abi,functionName:'transfer',args:[investor,10n**18n]}));
    async function swap(buy:boolean,amount:bigint){const path=buy?[cash,token]:[token,cash];const out=(await client.readContract({address:router,abi:routerAbi,functionName:'getAmountsOut',args:[amount,path]})).at(-1)!;await approve(i,path[0],router,amount);await confirm(await i.writeContract({address:router,abi:routerAbi,functionName:'swapExactTokensForTokens',args:[amount,min(out),path,investor,await deadline()]}));}
    await swap(true,scale);await swap(false,10n**17n);
    const beforeLP=await vaultSnapshot(client,manifest,vault,creator);if(!beforeLP.pool)throw Error('Pool unavailable');
    const addCash=scale,addShares=addCash*beforeLP.pool.shares/beforeLP.pool.cash;
    await approve(c,cash,router,addCash);await approve(c,token,router,addShares);
    await confirm(await c.writeContract({address:router,abi:routerAbi,functionName:'addLiquidity',args:[cash,token,addCash,addShares,min(addCash),min(addShares),creator,await deadline()]}));
    const afterLP=await vaultSnapshot(client,manifest,vault,creator);if(!afterLP.pool)throw Error('Pool unavailable');
    expect(afterLP.pool.lpBalance).toBeGreaterThan(beforeLP.pool.lpBalance);expect(afterLP.aum).toBe(beforeLP.aum);expect(afterLP.supply).toBe(beforeLP.supply);
    const lp=afterLP.pool.lpBalance/2n;const out=lpAmounts(lp,afterLP.pool.cash,afterLP.pool.shares,afterLP.pool.supply);
    await approve(c,opening.pair,router,lp);
    await confirm(await c.writeContract({address:router,abi:routerAbi,functionName:'removeLiquidity',args:[cash,token,lp,min(out.cash),min(out.shares),creator,await deadline()]}));
    const amount=10n**18n;
    const [gross,fee,net]=await client.readContract({address:vault,abi:vaultAbi,functionName:'previewRedeem',args:[investor,amount]});expect(fee).toBe(gross*10n/10000n);expect(net).toBe(gross-fee);
    const [,legs]=await client.readContract({address:vault,abi:vaultAbi,functionName:'previewRedeemAssets',args:[investor,amount]});expect(legs.length).toBe(basket.constituents.length);
    await approve(i,token,vault,amount);await confirm(await i.writeContract({address:vault,abi:vaultAbi,functionName:'redeem',args:[amount,min(net),legMinimums(legs,100),await deadline()]}));
    const afterUSDT=await vaultSnapshot(client,manifest,vault,investor);expect(afterUSDT.supply).toBe(deposited.supply-amount);expect(afterUSDT.shares).toBeGreaterThan(0n);
    // In-kind exit: exact underlying tokens, 10 bps of each to the creator, no swaps or oracle.
    const kind=afterUSDT.shares/2n;
    const [kindGross,kindFees,kindNet]=await client.readContract({address:vault,abi:vaultAbi,functionName:'previewRedeemInKind',args:[investor,kind]});
    const balances=(who:Address)=>Promise.all(basket.constituents.map(l=>client.readContract({address:l.token,abi:erc20Abi,functionName:'balanceOf',args:[who]})));
    const [inv0,cre0]=await Promise.all([balances(investor),balances(creator)]);
    await approve(i,token,vault,kind);await confirm(await i.writeContract({address:vault,abi:vaultAbi,functionName:'redeemInKind',args:[kind,legMinimums(kindNet,0),await deadline()]}));
    const [inv1,cre1]=await Promise.all([balances(investor),balances(creator)]);
    kindGross.forEach((g,k)=>{expect(kindFees[k]).toBe(g*10n/10000n);expect(inv1[k]-inv0[k]).toBe(kindNet[k]);expect(cre1[k]-cre0[k]).toBe(kindFees[k]);});
    const final=await vaultSnapshot(client,manifest,vault,investor);expect(final.supply).toBe(afterUSDT.supply-kind);expect(final.shares).toBe(afterUSDT.shares-kind);
  },120000);
});
