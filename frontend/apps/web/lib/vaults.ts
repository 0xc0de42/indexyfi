import {decodeEventLog, encodeFunctionData, encodePacked, erc20Abi, formatUnits, getAddress, isAddress, keccak256, parseAbi, parseUnits, toHex, zeroHash, type Address, type Hex, type PublicClient, type TransactionReceipt} from 'viem';
import {bscTestnet, hardhat} from 'viem/chains';
import {NO_PRICES, pricesByFeed, type SignedPrices} from './atlas-signed';
import {z} from 'zod';
import {referenceAssetById} from './catalog';
import {marketPrice18} from './pool-math';
import {parseFlapManifest, type FlapManifest} from './flap-manifest';
export {marketPrice18,lpAmounts} from './pool-math';

const selectedChain = process.env.NEXT_PUBLIC_VAULT_CHAIN_ID || '97';
if (!['31337', '97'].includes(selectedChain)) throw Error('Unsupported vault chain');
export const vaultChain = selectedChain === '31337' ? hardhat : bscTestnet;
/**
 * Keyless chain-97 RPC endpoints, fastest first (all answered chain 97 and Multicall3 on 2026-11-26, 480–650 ms).
 * BNB Chain documents 10K requests / 5 min per endpoint; PublicNode publishes no limit. No API keys, so no quota to run
 * out and nothing secret in the bundle. The app fails over between them (components/providers.tsx).
 */
export const BSC_TESTNET_RPCS = [
  'https://bsc-testnet-rpc.publicnode.com',
  'https://bsc-testnet-dataseed.bnbchain.org',
  'https://bsc-testnet.bnbchain.org',
  'https://bsc-prebsc-dataseed.bnbchain.org',
] as const;
const rpcList = (value?: string) => (value ?? '').split(',').map(url => url.trim()).filter(Boolean);
/** NEXT_PUBLIC_VAULT_RPC_URL (one URL) wins; else NEXT_PUBLIC_VAULT_RPC_URLS (comma list); else the defaults. */
export const vaultRpcs: readonly string[] =
  process.env.NEXT_PUBLIC_VAULT_RPC_URL ? [process.env.NEXT_PUBLIC_VAULT_RPC_URL]
  : vaultChain.id === 31337 ? ['http://127.0.0.1:8545']
  : rpcList(process.env.NEXT_PUBLIC_VAULT_RPC_URLS).length ? rpcList(process.env.NEXT_PUBLIC_VAULT_RPC_URLS)
  : process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL ? [process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL]
  : BSC_TESTNET_RPCS;
export const vaultRpc = vaultRpcs[0];
export const manifestUrl = process.env.NEXT_PUBLIC_VAULT_MANIFEST_URL || `/deployments/${vaultChain.id}.json`;
const address = z.string().refine(x => isAddress(x)).transform(x => getAddress(x));
const decimals = z.number().int().min(0).max(18);
const token = z.object({address, symbol:z.string().min(1), decimals, referenceAssetId:z.string(), feedId:z.number().int().positive(), isMock:z.boolean().default(false)});
const deployment = z.object({
  schemaVersion:z.literal(5), fixture:z.boolean(), supplyModel:z.enum(["standard-openfour-inventory","flap-dock-inventory"]),
  /** Launch provider. Flap deployments come from a schema-6 manifest converted by flapToDeployment. */
  provider:z.enum(["openfour","flap"]).default("openfour"),
  /** Flap-only launch parameters (docs/flap/FORK_ACCEPTANCE.md). */
  flap:z.object({portal:address, dockRouter:address, guardian:address, vaultFactory:address, vaultImplementation:address, tokenImplementation:address,
    saltSuffix:z.string(), buyTaxBps:z.number().int(), sellTaxBps:z.number().int(), taxDuration:z.number().int(), cap:z.string()}).optional(),
  /** Public test deployment whose assets are labelled test tokens standing in for mainnet assets (chain 97). */
  testAssets:z.boolean().default(false),
  /** Superseded vaults the app does not list (they stay on chain and reachable by address). */
  hiddenVaults:z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).default([]),
  /** OpenFour Core the factory launches through; its signer() authorizes launches on public chains. */
  openfour:z.object({core:address, registry:address, presetId:z.union([z.string(),z.number()])}).optional(),
  /** Contract features of this deployment. rebalancing: factory/vault 5.2+ (docs/rebalancing/IMPLEMENTATION_PLAN.md). */
  features:z.object({rebalancing:z.boolean().default(false)}).default({rebalancing:false}),
  chainId:z.number().int(), factory:address, deploymentBlock:z.number().int().nonnegative(),
  settlementToken:address, settlementDecimals:decimals, adapter:address, oracle:address, router:address, assets:z.array(token).min(1),
});
export type Deployment = z.infer<typeof deployment>;
export function parseDeployment(input:unknown, chainId:number):Deployment {
  const d = deployment.parse(input);
  if(d.chainId !== chainId) throw Error('Deployment chain mismatch');
  if(d.fixture !== (chainId===31337) || (!d.fixture && !d.testAssets && d.assets.some(a=>a.isMock))) throw Error('Fixture network mismatch');
  if(d.testAssets && (d.fixture || !d.assets.every(a=>a.isMock))) throw Error('Test-asset deployments must be public and label every asset');
  if([d.factory,d.settlementToken,d.adapter,d.oracle,d.router,...d.assets.map(a=>a.address)].some(a=>/^0x0{40}$/i.test(a))) throw Error('Zero deployment address');
  if(new Set(d.assets.map(a=>a.referenceAssetId)).size !== d.assets.length) throw Error('Duplicate execution asset reference');
  if(new Set(d.assets.map(a=>a.address)).size !== d.assets.length) throw Error('Duplicate execution asset');
  for(const a of d.assets) {
    const ref = referenceAssetById(a.referenceAssetId);
    if(!ref || ref.id !== a.referenceAssetId || ref.feedId !== a.feedId) throw Error(`Invalid reference mapping for ${a.symbol}`);
  }
  return d;
}

const constituent = 'struct Constituent { address token; uint16 weightBps; }' as const;
const basket = 'struct Basket { string name; string symbol; string metadataURI; Constituent[] constituents; }' as const;
export const factoryAbi = parseAbi([constituent, basket,
  'function minimumSeed() view returns (uint256)', 'function minimumLiquidity() view returns (uint256)', 'function router() view returns (address)', 'function oracle() view returns (address)', 'function adapter() view returns (address)', 'function settlementToken() view returns (address)',
  'function vaultCount() view returns (uint256)', 'function vaultAt(uint256 index) view returns (address)',
  'function previewCreate(Basket basket,uint256 seedUSDT) view returns (uint256[] tokenOut)',
  'function createVault(uint256 requestId,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minTokenOut,uint256 deadline,bytes launchAuthorization) payable returns (address vault,uint256 seedShares)',
  'function createVaultWithPrices(bytes[] payloads,bytes[] signatures,uint256 requestId,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minTokenOut,uint256 deadline,bytes launchAuthorization) payable returns (address vault,uint256 seedShares)',
  'function quoteCreateWithPrices(bytes[] payloads,bytes[] signatures,Basket basket,uint256 seedUSDT) returns (uint256[] tokenOut)',
  'function usedRequestIds(uint256 requestId) view returns (bool)', 'function isVault(address vault) view returns (bool)',
  'event VaultCreated(address indexed creator,address indexed vault,uint256 indexed requestId,uint256 seedUSDT)',
  'event PortfolioLaunched(address indexed vault,address indexed token,address indexed pair,uint256 collateralUSDT,uint256 liquidityUSDT,uint256 outstandingSupply)',
  'function buildCreateArgs(uint256 requestId,address creator,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minimums,uint256 deadline,uint256 createFee) view returns (bytes)',
]);
/**
 * Rebalancing interface of vault / factory 5.2 (docs/rebalancing/IMPLEMENTATION_PLAN.md §2.1). Used only when the manifest
 * sets features.rebalancing (factory) or a vault answers rebalanceConfig(); older contracts keep the ABIs above.
 */
const rebalanceConfigStruct = 'struct RebalanceConfig { uint32 interval; uint16 thresholdBps; }' as const;
/** kind 0 manual, 1 top-N by market cap; weighting 0 market cap, 1 equal; universe keccak256(category) or 0x0 for all. */
const indexRuleStruct = 'struct IndexRule { uint8 kind; uint8 size; uint8 weighting; uint16 maxWeightBps; bytes32 universe; }' as const;
export const rebalanceAbi = parseAbi([
  'function rebalanceConfig() view returns (uint32 interval,uint16 thresholdBps,uint64 lastRebalanceAt)',
  'function quoteRebalanceWithPrices(bytes[] payloads,bytes[] signatures) returns (uint256 driftBps,bool due,uint256[] expectedOut)',
  'function rebalanceWithPrices(bytes[] payloads,bytes[] signatures,uint256[] minOut,uint256 deadline) returns (uint256 navBefore,uint256 navAfter)',
  'event Rebalanced(address indexed caller,uint256 driftBps,uint256 navBefore,uint256 navAfter,uint64 at)',
  'function indexRule() view returns (uint8 kind,uint8 size,uint8 weighting,uint16 maxWeightBps,bytes32 universe)',
  'event Reconstituted(address indexed operator,address[] removed,address[] added)',
]);
export const factoryRebalanceAbi = parseAbi([constituent, basket, rebalanceConfigStruct, indexRuleStruct,
  'function createVaultWithPrices(bytes[] payloads,bytes[] signatures,uint256 requestId,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minTokenOut,uint256 deadline,bytes launchAuthorization,RebalanceConfig rebalance,IndexRule rule) payable returns (address vault,uint256 seedShares)',
  'function buildCreateArgs(uint256 requestId,address creator,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minimums,uint256 deadline,uint256 createFee,RebalanceConfig rebalance,IndexRule rule) view returns (bytes)',
]);
export interface OnchainRebalance {
  readonly intervalSeconds: number;
  readonly thresholdBps: number;
  /** Unix seconds; the launch time until the first rebalance. */
  readonly lastRebalanceAt: number;
}
/** The vault's rebalancing config, or null when the vault predates rebalancing (5.1) and the call reverts. */
export async function readRebalance(client:PublicClient,vault:Address):Promise<OnchainRebalance|null>{
  try{
    const [interval,thresholdBps,last]=await client.readContract({address:vault,abi:rebalanceAbi,functionName:'rebalanceConfig'});
    return {intervalSeconds:Number(interval),thresholdBps:Number(thresholdBps),lastRebalanceAt:Number(last)};
  }catch{return null;}
}
/** Encode a frontend index rule for the 5.2 factory. */
export function indexRuleArg(rule:{kind:'manual'|'topCap';universe:string;size:number;weighting:'cap'|'equal';maxWeightBps:number}|undefined){
  if(!rule||rule.kind==='manual') return {kind:0,size:0,weighting:0,maxWeightBps:0,universe:zeroHash};
  return {kind:1,size:rule.size,weighting:rule.weighting==='equal'?1:0,maxWeightBps:rule.weighting==='equal'?0:rule.maxWeightBps,universe:rule.universe==='All'?zeroHash:keccak256(toHex(rule.universe))};
}
/** The vault's index rule (5.2+), with the universe decoded against known categories; null before 5.2 or for manual. */
export async function readIndexRule(client:PublicClient,vault:Address,categories:readonly string[]){
  try{
    const [kind,size,weighting,maxWeightBps,universe]=await client.readContract({address:vault,abi:rebalanceAbi,functionName:'indexRule'});
    if(kind!==1) return null;
    const name=universe===zeroHash?'All':categories.find(c=>keccak256(toHex(c))===universe);
    return name?{kind:'topCap' as const,universe:name,size:Number(size),weighting:weighting===1?'equal' as const:'cap' as const,maxWeightBps:Number(maxWeightBps)}:null;
  }catch{return null;}
}
export interface RebalanceEvent { readonly tx:`0x${string}`; readonly block:bigint; readonly at:number; readonly driftBps:number; readonly navBefore:bigint; readonly navAfter:bigint; readonly caller:Address }
/** Past rebalances, newest first; null if the RPC refuses the log range. */
export async function rebalanceHistory(client:PublicClient,vault:Address,fromBlock:bigint):Promise<RebalanceEvent[]|null>{
  try{
    const logs=await client.getContractEvents({address:vault,abi:rebalanceAbi,eventName:'Rebalanced',fromBlock,toBlock:'latest'});
    return logs.map(l=>({tx:l.transactionHash,block:l.blockNumber,at:Number(l.args.at??0n),driftBps:Number(l.args.driftBps??0n),navBefore:l.args.navBefore??0n,navAfter:l.args.navAfter??0n,caller:l.args.caller!})).reverse();
  }catch{return null;}
}

export const vaultAbi = parseAbi([constituent,
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function creator() view returns (address)',
  'function totalSupply() view returns (uint256)', 'function closed() view returns (bool)',
  'function token() view returns (address)', 'function pair() view returns (address)', 'function phase() view returns (uint8)',
  'function outstandingSupply() view returns (uint256)', 'function inventory() view returns (uint256)',
  'function nav() view returns (uint256)', 'function collateralValue() view returns (uint256)',
  'function collateralBalance(address asset) view returns (uint256)', 'function factory() view returns (address)',
  'function constituents() view returns (Constituent[])',
  'function previewDeposit(uint256 usdtIn) view returns (uint256 shares,uint256[] tokenOut)',
  'function previewRedeem(address holder,uint256 shares) view returns (uint256 grossUSDT,uint256 creatorFeeUSDT,uint256 netUSDT)',
  'function deposit(uint256 usdtIn,uint256 minSharesOut,uint256[] minTokenOut,uint256 deadline) returns (uint256 shares)',
  'function depositWithPrices(bytes[] payloads,bytes[] signatures,uint256 usdtIn,uint256 minSharesOut,uint256[] minTokenOut,uint256 deadline) returns (uint256 shares)',
  'function quoteDepositWithPrices(bytes[] payloads,bytes[] signatures,uint256 usdtIn) returns (uint256 shares,uint256[] tokenOut)',
  'function redeemWithPrices(bytes[] payloads,bytes[] signatures,uint256 shares,uint256 minNetUSDT,uint256[] minAssetOut,uint256 deadline) returns (uint256 netUSDT,uint256 creatorFeeUSDT)',
  'function redeemInKindWithPrices(bytes[] payloads,bytes[] signatures,uint256 shares,uint256[] minAmountsOut,uint256 deadline) returns (uint256[] netAmounts,uint256[] creatorFeeAmounts)',
  'function previewRedeemAssets(address holder,uint256 shares) view returns (uint256[] assetAmounts,uint256[] expectedUSDT)',
  'function previewRedeemInKind(address holder,uint256 shares) view returns (uint256[] grossAmounts,uint256[] creatorFeeAmounts,uint256[] netAmounts)',
  'function redeem(uint256 shares,uint256 minNetUSDT,uint256[] minAssetOut,uint256 deadline) returns (uint256 netUSDT,uint256 creatorFeeUSDT)',
  'function redeemInKind(uint256 shares,uint256[] minAmountsOut,uint256 deadline) returns (uint256[] netAmounts,uint256[] creatorFeeAmounts)',
  'event Deposited(address indexed holder,uint256 usdtIn,uint256 shares,uint256 creatorFeeUSDT)',
  'event Redeemed(address indexed holder,uint256 shares,uint256 grossUSDT,uint256 creatorFeeUSDT,uint256 netUSDT)',
  'event RedeemedInKind(address indexed holder,uint256 shares)',
  // Flap vault only: forwards unaccounted settlement surplus (tax revenue) to the creator; permissionless.
  'function forwardTaxRevenue() returns (uint256 amount)',
  'event RedeemedAsset(address indexed holder,address indexed asset,uint256 grossAmount,uint256 creatorFeeAmount,uint256 netAmount)',
]);

export function exactAmount(value:string, precision:number):bigint | undefined {
  if(!/^\d+(\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0)>precision) return;
  const amount=parseUnits(value,precision);
  if(amount>0n && amount < 2n**256n) return amount;
}
export function floorOutput(quote:bigint, slipBps:number) {
  if(!Number.isInteger(slipBps) || slipBps<0 || slipBps>1000) throw Error('Choose slippage from 0% to 10%');
  const minimum=quote*BigInt(10000-slipBps)/10000n;
  return quote>0n && minimum===0n ? 1n : minimum;
}
/** Applies the slippage floor independently to every leg; zero legs stay zero. */
export const legMinimums=(quotes:readonly bigint[],slipBps:number)=>quotes.map(q=>floorOutput(q,slipBps));

/** Ceiling for any one transaction: below the 16,777,216 per-transaction cap (EIP-7825) that Hardhat's Osaka rules enforce. */
export const GAS_CAP=16_000_000n;
export type GasKind='create'|'createFlap'|'deposit'|'redeem'|'redeemInKind'|'swap'|'addLiquidity'|'removeLiquidity'|'rebalance'|'forwardTax';
/**
 * Size-based limits (~25% over gas measured on the fixture, 2–32 assets): launch 4.03M→11.88M,
 * deposit 0.43M→4.66M, redeem 0.39M→4.56M, in-kind 0.23M→2.61M, plus ~0.15M + ~30k per feed for the signed
 * price update the *WithPrices entry points run first. Used when a node cannot estimate.
 */
const FALLBACK:{[K in GasKind]:{base:bigint;perLeg:bigint}}={
  create:{base:4_650_000n,perLeg:340_000n}, deposit:{base:450_000n,perLeg:210_000n}, redeem:{base:450_000n,perLeg:210_000n},
  redeemInKind:{base:350_000n,perLeg:140_000n}, swap:{base:600_000n,perLeg:0n}, addLiquidity:{base:600_000n,perLeg:0n}, removeLiquidity:{base:600_000n,perLeg:0n},
  // Planned (vault 5.2): one sell or buy per leg plus the signed price update.
  rebalance:{base:600_000n,perLeg:260_000n},
  // Flap launch through the real Portal: 7.67M for 2 legs on the chain-97 fork (docs/flap/FORK_ACCEPTANCE.md).
  createFlap:{base:7_800_000n,perLeg:400_000n}, forwardTax:{base:200_000n,perLeg:0n},
};
/**
 * Explicit gas limit for a write. Every write sends one, so wallets never re-estimate: Hardhat's estimator overshoots
 * by ~8/3 and fails above the per-transaction cap for launches of 9+ assets, although execution needs far less.
 * Uses the node's estimate +20% when available, else the size-based fallback; never above GAS_CAP.
 */
export function gasLimit(kind:GasKind,legs:number,estimate?:bigint):bigint {
  if(!Number.isInteger(legs)||legs<0) throw Error('Invalid leg count');
  const f=FALLBACK[kind];
  const limit=estimate&&estimate>0n ? estimate*12n/10n : f.base+f.perLeg*BigInt(legs);
  return limit>GAS_CAP ? GAS_CAP : limit;
}
/** High-entropy, nonzero launch request ID (never derived from vaultCount). */
export function newRequestId():bigint {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const id=bytes.reduce((n,b)=>(n<<8n)|BigInt(b),0n);
  return id===0n?1n:id;
}
export type LaunchAuthorization={requestId:bigint;authorization:`0x${string}`};
/** Fixture Core accepts an empty signature. Public chains need a signature from OpenFour Core's signer (see launchDigest). */
export async function authorizeLaunch(d:Pick<Deployment,'fixture'>):Promise<LaunchAuthorization> {
  if(!d.fixture) throw Error('Public launch authorization is not configured. Creation is disabled on this deployment.');
  return {requestId:newRequestId(),authorization:'0x'};
}
export const coreAbi=parseAbi(['function signer() view returns (address)']);
/**
 * OpenFour launch digest, signed EIP-191 (personal_sign over the 32 raw bytes) by Core.signer. The caller Core sees is
 * the IndexFi factory, and createArgs come from factory.buildCreateArgs with exactly the values the launch then uses.
 */
export const launchDigest=(chainId:number,factory:Address,createArgs:Hex)=>
  keccak256(encodePacked(['string','uint256','address','bytes32'],['createOpenFourToken',BigInt(chainId),factory,keccak256(createArgs)]));
/** OpenFour Core's launch signer, or null without a Core in the manifest (local fixture). */
export async function launchSigner(client:PublicClient,d:Pick<Deployment,'openfour'>):Promise<Address|null>{
  if(!d.openfour) return null;
  return client.readContract({address:d.openfour.core as Address,abi:coreAbi,functionName:'signer'});
}
/** Wallet funds a launch needs: settlement-token balance and native gas. */
export async function walletFunds(client:PublicClient,d:Deployment,holder:Address){
  const [usdt,gas]=await Promise.all([
    client.readContract({address:d.settlementToken,abi:erc20Abi,functionName:'balanceOf',args:[holder]}),
    client.getBalance({address:holder})]);
  return {usdt,gas};
}
export const MIN_GAS=10n**16n; // 0.01 native token
export const FAUCET_USDT=10_000n;
/**
 * Local-fixture faucet: sets native gas on the Hardhat node and mints test USDT from the node's
 * unlocked deployer. Refuses anything except chain 31337 on a loopback RPC.
 */
export async function fundFixtureWallet(client:PublicClient,d:Deployment,holder:Address){
  const url=new URL(vaultRpc??'http://invalid');
  if(!d.fixture||d.chainId!==31337||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Test funds are only available on the local fixture chain.');
  const request=client.request as unknown as (args:{method:string;params:unknown[]})=>Promise<unknown>;
  await request({method:'hardhat_setBalance',params:[holder,`0x${(10n*10n**18n).toString(16)}`]});
  const [deployer]=await request({method:'eth_accounts',params:[]}) as Address[];
  if(!deployer)throw Error('Local node has no unlocked deployer account.');
  const data=encodeFunctionData({abi:parseAbi(['function mint(address to,uint256 amount)']),functionName:'mint',args:[holder,FAUCET_USDT*10n**BigInt(d.settlementDecimals)]});
  const hash=await request({method:'eth_sendTransaction',params:[{from:deployer,to:d.settlementToken,data}]}) as `0x${string}`;
  const receipt=await client.waitForTransactionReceipt({hash});
  if(receipt.status!=='success')throw Error('Test USDT mint failed.');
}
export const flapManifestUrl = process.env.NEXT_PUBLIC_FLAP_MANIFEST_URL || `/deployments/${vaultChain.id}/flap.json`;
/** A Flap schema-6 manifest in the app's deployment shape: reads, deposits and redemptions share the OpenFour ABI. */
export function flapToDeployment(m:FlapManifest):Deployment {
  return deployment.parse({
    schemaVersion:5, fixture:m.fixture, supplyModel:'flap-dock-inventory', provider:'flap', testAssets:m.testAssets, hiddenVaults:[],
    features:{rebalancing:false}, chainId:m.chainId, factory:m.factory, deploymentBlock:m.deploymentBlock, settlementToken:m.settlementToken,
    settlementDecimals:m.settlementDecimals, adapter:m.adapter, oracle:m.oracle, router:m.router,
    assets:m.assets.map(a=>({address:a.address,symbol:a.symbol,decimals:a.decimals,referenceAssetId:a.referenceAssetId,feedId:a.feedId,isMock:a.isMock})),
    flap:{portal:m.portal,dockRouter:m.dockRouter,guardian:m.guardian,vaultFactory:m.vaultFactory,vaultImplementation:m.vaultImplementation,
      tokenImplementation:m.tokenImplementation,saltSuffix:m.salt.suffix,buyTaxBps:m.buyTaxBps,sellTaxBps:m.sellTaxBps,taxDuration:m.taxDuration,cap:m.cap},
  });
}
/** The Flap deployment for the active chain, or null when none is published (404). Verified against chain like OpenFour. */
export async function loadFlapDeployment(client:PublicClient, signal?:AbortSignal):Promise<Deployment|null> {
  const response=await fetch(flapManifestUrl,{signal,cache:'no-store'});
  if(response.status===404) return null;
  if(!response.ok) throw Error(`Flap manifest unavailable for chain ${vaultChain.id}`);
  const d=flapToDeployment(parseFlapManifest(await response.json()));
  if(d.chainId!==vaultChain.id) throw Error('Flap deployment chain mismatch');
  return verifyDeployment(client,d);
}
export async function loadDeployment(client:PublicClient, signal?:AbortSignal) {
  const response=await fetch(manifestUrl,{signal,cache:'no-store'});
  if(!response.ok) throw Error(`Deployment manifest unavailable for chain ${vaultChain.id}`);
  return verifyDeployment(client,parseDeployment(await response.json(),vaultChain.id));
}
/** The manifest's bindings must match what the factory reports on chain, and every asset's decimals. */
async function verifyDeployment(client:PublicClient,d:Deployment):Promise<Deployment> {
  const [rpcChain,usdt,precision,router,oracle,adapter]=await Promise.all([client.getChainId(),
    client.readContract({address:d.factory,abi:factoryAbi,functionName:'settlementToken'}),
    client.readContract({address:d.settlementToken,abi:erc20Abi,functionName:'decimals'}),
    client.readContract({address:d.factory,abi:factoryAbi,functionName:'router'}),
    client.readContract({address:d.factory,abi:factoryAbi,functionName:'oracle'}),
    client.readContract({address:d.factory,abi:factoryAbi,functionName:'adapter'})]);
  if(rpcChain!==d.chainId || getAddress(usdt)!==d.settlementToken || precision!==d.settlementDecimals || getAddress(router)!==d.router || getAddress(oracle)!==d.oracle || getAddress(adapter)!==d.adapter) throw Error('RPC deployment does not match the manifest');
  const assetDecimals=await Promise.all(d.assets.map(a=>client.readContract({address:a.address,abi:erc20Abi,functionName:'decimals'})));
  if(assetDecimals.some((n,i)=>n!==d.assets[i].decimals))throw Error('Execution asset decimals mismatch');
  return d;
}
/** Unix seconds of the block that created `vault` (its factory's VaultCreated), searching back in RPC-sized chunks. */
export async function vaultLaunchTime(client:PublicClient,d:Deployment,vault:Address,chunk=40_000n):Promise<number|null>{
  const latest=await client.getBlockNumber();
  const floor=BigInt(d.deploymentBlock);
  for(let to=latest;to>=floor;to-=chunk){
    const from=to-chunk+1n>floor?to-chunk+1n:floor;
    const logs=await client.getContractEvents({address:d.factory,abi:factoryAbi,eventName:'VaultCreated',args:{vault},fromBlock:from,toBlock:to}).catch(()=>null);
    if(logs===null) return null;
    if(logs.length) return Number((await client.getBlock({blockNumber:logs[0].blockNumber})).timestamp);
    if(from===floor) break;
  }
  return null;
}
export async function listVaults(client:PublicClient,d:Deployment,at?:bigint) {
  const blockNumber=at??await client.getBlockNumber({cacheTime:0});
  const config={address:d.factory,abi:factoryAbi,blockNumber} as const;
  const count=await client.readContract({...config,functionName:'vaultCount'});
  const addresses:Address[]=[];
  for(let i=0n;i<count;i+=32n) {
    const chunk=Number(count-i<32n ? count-i : 32n);
    addresses.push(...await Promise.all(Array.from({length:chunk},(_,k)=>client.readContract({...config,functionName:'vaultAt',args:[i+BigInt(k)]}))));
  }
  return addresses;
}
export async function vaultSnapshot(client:PublicClient,d:Deployment,address:Address,holder?:Address) {
  const blockNumber=await client.getBlockNumber({cacheTime:0});
  if(!await client.readContract({address:d.factory,abi:factoryAbi,functionName:'isVault',args:[address],blockNumber}))throw Error('Unregistered vault');
  const config={address,abi:vaultAbi,blockNumber} as const;
  const [name,symbol,creator,closed,supply,legs,token,pair,phase,inventory,factory,nav,aum]=await Promise.all([
    client.readContract({...config,functionName:'name'}),client.readContract({...config,functionName:'symbol'}),
    client.readContract({...config,functionName:'creator'}),client.readContract({...config,functionName:'closed'}),
    client.readContract({...config,functionName:'outstandingSupply'}),client.readContract({...config,functionName:'constituents'}),
    client.readContract({...config,functionName:'token'}),client.readContract({...config,functionName:'pair'}),
    client.readContract({...config,functionName:'phase'}),client.readContract({...config,functionName:'inventory'}),
    client.readContract({...config,functionName:'factory'}),
    client.readContract({...config,functionName:'nav'}).catch(()=>null),
    client.readContract({...config,functionName:'collateralValue'}).catch(()=>null),
  ]);
  if(getAddress(factory)!==d.factory) throw Error('Vault factory mismatch');
  const holdings=await Promise.all(legs.map(async leg=>{
    const asset=d.assets.find(a=>a.address===getAddress(leg.token));
    if(!asset) throw Error('Vault contains a token outside the deployment manifest');
    const balance=await client.readContract({...config,functionName:'collateralBalance',args:[asset.address]});
    return {...asset,weightBps:leg.weightBps,balance};
  }));
  const shares=holder ? await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[holder],blockNumber}) : 0n;
  const pool=await poolSnapshot(client,d,token,pair,holder,blockNumber).catch(()=>null);
  return {address,name,symbol,creator,closed,supply,shares,holdings,blockNumber,token,pair,phase,inventory,nav,aum,pool};
}
export type VaultSnapshot = Awaited<ReturnType<typeof vaultSnapshot>>;
export function vaultEvent(receipt:TransactionReceipt,source:Address) {
  for(const log of receipt.logs) {
    if(getAddress(log.address)!==getAddress(source)) continue;
    try {
      const decoded=decodeEventLog({abi:[...factoryAbi,...vaultAbi],data:log.data,topics:log.topics});
      return decoded;
    } catch { /* A contract may emit additional unrelated logs. */ }
  }
  throw Error('Transaction confirmed without the expected vault event');
}
export const units=(value:bigint,decimals:number)=>formatUnits(value,decimals);

export const oracleAbi=parseAbi(['function price18(address asset) view returns (uint256)']);
export const pairAbi=parseAbi(['function token0() view returns (address)','function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 timestamp)']);
export const routerAbi=parseAbi([
  'function factory() view returns (address)',
  'function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)',
  // Flap portfolio tokens are tax tokens: swaps must tolerate a transfer fee.
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)',
  'function addLiquidity(address tokenA,address tokenB,uint256 amountADesired,uint256 amountBDesired,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB,uint256 liquidity)',
  'function removeLiquidity(address tokenA,address tokenB,uint256 liquidity,uint256 amountAMin,uint256 amountBMin,address to,uint256 deadline) returns (uint256 amountA,uint256 amountB)',
]);
const dexFactoryAbi=parseAbi(['function getPair(address tokenA,address tokenB) view returns (address)']);
export async function poolSnapshot(client:PublicClient,d:Deployment,token:Address,pair:Address,holder:Address|undefined,blockNumber:bigint){
  const c={address:pair,abi:pairAbi,blockNumber} as const;
  const [t0,t1,reserves,supply,lpBalance,dexFactory]=await Promise.all([
    client.readContract({...c,functionName:'token0'}),client.readContract({...c,functionName:'token1'}),
    client.readContract({...c,functionName:'getReserves'}),
    client.readContract({address:pair,abi:erc20Abi,functionName:'totalSupply',blockNumber}),
    holder ? client.readContract({address:pair,abi:erc20Abi,functionName:'balanceOf',args:[holder],blockNumber}) : 0n,
    client.readContract({address:d.router,abi:routerAbi,functionName:'factory',blockNumber}),
  ]);
  const expected=await client.readContract({address:dexFactory,abi:dexFactoryAbi,functionName:'getPair',args:[token,d.settlementToken],blockNumber});
  if(getAddress(expected)!==getAddress(pair))throw Error('Pair/router mismatch');
  const cashFirst=getAddress(t0)===d.settlementToken;
  if(getAddress(cashFirst?t1:t0)!==getAddress(token)||getAddress(cashFirst?t0:t1)!==d.settlementToken)throw Error('Pair asset mismatch');
  const [cash,shares]=cashFirst?[reserves[0],reserves[1]]:[reserves[1],reserves[0]];
  return {cash,shares,supply,lpBalance,marketPrice:marketPrice18(cash,shares,d.settlementDecimals)};
}
/** Feed ids of the given execution tokens, in order. */
export function feedIdsFor(d:Deployment,tokens:readonly Address[]):number[] {
  return tokens.map(t=>{const a=d.assets.find(x=>x.address===getAddress(t));if(!a)throw Error('Unknown executable asset');return a.feedId;});
}
/**
 * Latest Atlas-signed prices for the given feeds, from this app's server route (the key stays server-side).
 * The local fixture's mock oracle is owner-priced, so nothing is injected there.
 */
export async function signedPrices(d:Pick<Deployment,'fixture'>,feeds:readonly number[],signal?:AbortSignal):Promise<SignedPrices> {
  if(d.fixture||!feeds.length) return NO_PRICES;
  const response=await fetch(`/api/atlas/signed?feeds=${feeds.join(',')}`,{cache:'no-store',signal});
  const body=await response.json().catch(()=>null) as {payloads?:unknown;signatures?:unknown;message?:unknown}|null;
  if(!response.ok||!body||!Array.isArray(body.payloads)||!Array.isArray(body.signatures)||body.payloads.length!==body.signatures.length)
    throw Error(`Signed Atlas prices unavailable${body&&typeof body.message==='string'?`: ${body.message}`:''}`);
  return {payloads:body.payloads as `0x${string}`[],signatures:body.signatures as `0x${string}`[]};
}
export async function quoteCreate(client:PublicClient,d:Deployment,basket:{name:string;symbol:string;metadataURI:string;constituents:{token:Address;weightBps:number}[]},seed:bigint,liquidity:bigint){
  let outputs:readonly bigint[], prices:bigint[];
  if(d.fixture){
    const blockNumber=await client.getBlockNumber({cacheTime:0});
    outputs=await client.readContract({address:d.factory,abi:factoryAbi,functionName:'previewCreate',args:[basket,seed],blockNumber});
    prices=await Promise.all(basket.constituents.map(a=>client.readContract({address:d.oracle,abi:oracleAbi,functionName:'price18',args:[a.token],blockNumber})));
  } else {
    // Quote with the latest signed prices injected inside eth_call, so no stored price is needed and the quote uses
    // the same prices the launch will post.
    const feeds=feedIdsFor(d,basket.constituents.map(c=>c.token));
    const signed=await signedPrices(d,feeds);
    outputs=(await client.simulateContract({address:d.factory,abi:factoryAbi,functionName:'quoteCreateWithPrices',args:[signed.payloads,signed.signatures,basket,seed]})).result;
    const latest=pricesByFeed(signed);
    prices=feeds.map(f=>{const r=latest.get(f);if(!r)throw Error('Atlas price missing for a basket asset');return r.price18;});
  }
  const total=outputs.reduce((sum,o,i)=>{const asset=d.assets.find(a=>a.address===getAddress(basket.constituents[i].token));if(!asset)throw Error('Unknown executable asset');return sum+o*prices[i]/10n**BigInt(asset.decimals);},0n);
  const lpShares=liquidity*10n**BigInt(18-d.settlementDecimals);
  if(total<=lpShares)throw Error('Liquidity must be smaller than acquired collateral value');
  return {outputs,creatorShares:total-lpShares,lpShares,total};
}
/** Deposit quote; on public chains the latest signed prices are injected inside eth_call. */
export async function quoteDeposit(client:PublicClient,d:Deployment,vault:Address,feeds:readonly number[],amount:bigint):Promise<readonly [bigint,readonly bigint[]]> {
  if(d.fixture) return client.readContract({address:vault,abi:vaultAbi,functionName:'previewDeposit',args:[amount]});
  const signed=await signedPrices(d,feeds);
  return (await client.simulateContract({address:vault,abi:vaultAbi,functionName:'quoteDepositWithPrices',args:[signed.payloads,signed.signatures,amount]})).result;
}
