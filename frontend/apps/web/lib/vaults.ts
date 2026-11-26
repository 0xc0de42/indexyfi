import {decodeEventLog, erc20Abi, formatUnits, getAddress, isAddress, parseAbi, parseUnits, type Address, type PublicClient, type TransactionReceipt} from 'viem';
import {bscTestnet, hardhat} from 'viem/chains';
import {z} from 'zod';
import {referenceAssetById} from './catalog';
import {marketPrice18} from './pool-math';
export {marketPrice18,lpAmounts} from './pool-math';

const selectedChain = process.env.NEXT_PUBLIC_VAULT_CHAIN_ID || '97';
if (!['31337', '97'].includes(selectedChain)) throw Error('Unsupported vault chain');
export const vaultChain = selectedChain === '31337' ? hardhat : bscTestnet;
export const vaultRpc = process.env.NEXT_PUBLIC_VAULT_RPC_URL ||
  (vaultChain.id === 31337 ? 'http://127.0.0.1:8545' : process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL);
export const manifestUrl = process.env.NEXT_PUBLIC_VAULT_MANIFEST_URL || `/deployments/${vaultChain.id}.json`;
const address = z.string().refine(x => isAddress(x)).transform(x => getAddress(x));
const decimals = z.number().int().min(0).max(18);
const token = z.object({address, symbol:z.string().min(1), decimals, referenceAssetId:z.string(), feedId:z.number().int().positive(), isMock:z.boolean().default(false)});
const deployment = z.object({
  schemaVersion:z.literal(5), fixture:z.boolean(), supplyModel:z.literal("standard-openfour-inventory"),
  chainId:z.number().int(), factory:address, deploymentBlock:z.number().int().nonnegative(),
  settlementToken:address, settlementDecimals:decimals, adapter:address, oracle:address, router:address, assets:z.array(token).min(1),
});
export type Deployment = z.infer<typeof deployment>;
export function parseDeployment(input:unknown, chainId:number):Deployment {
  const d = deployment.parse(input);
  if(d.chainId !== chainId) throw Error('Deployment chain mismatch');
  if(d.fixture !== (chainId===31337) || (!d.fixture && d.assets.some(a=>a.isMock))) throw Error('Fixture network mismatch');
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
  'function usedRequestIds(uint256 requestId) view returns (bool)', 'function isVault(address vault) view returns (bool)',
  'event VaultCreated(address indexed creator,address indexed vault,uint256 indexed requestId,uint256 seedUSDT)',
  'event PortfolioLaunched(address indexed vault,address indexed token,address indexed pair,uint256 collateralUSDT,uint256 liquidityUSDT,uint256 outstandingSupply)',
  'function buildCreateArgs(uint256 requestId,address creator,Basket basket,uint256 seedUSDT,uint256 liquidityUSDT,uint256 minCreatorShares,uint256[] minimums,uint256 deadline,uint256 createFee) view returns (bytes)',
]);
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
  'function previewRedeemAssets(address holder,uint256 shares) view returns (uint256[] assetAmounts,uint256[] expectedUSDT)',
  'function previewRedeemInKind(address holder,uint256 shares) view returns (uint256[] grossAmounts,uint256[] creatorFeeAmounts,uint256[] netAmounts)',
  'function redeem(uint256 shares,uint256 minNetUSDT,uint256[] minAssetOut,uint256 deadline) returns (uint256 netUSDT,uint256 creatorFeeUSDT)',
  'function redeemInKind(uint256 shares,uint256[] minAmountsOut,uint256 deadline) returns (uint256[] netAmounts,uint256[] creatorFeeAmounts)',
  'event Deposited(address indexed holder,uint256 usdtIn,uint256 shares,uint256 creatorFeeUSDT)',
  'event Redeemed(address indexed holder,uint256 shares,uint256 grossUSDT,uint256 creatorFeeUSDT,uint256 netUSDT)',
  'event RedeemedInKind(address indexed holder,uint256 shares)',
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
/** High-entropy, nonzero launch request ID (never derived from vaultCount). */
export function newRequestId():bigint {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  const id=bytes.reduce((n,b)=>(n<<8n)|BigInt(b),0n);
  return id===0n?1n:id;
}
export type LaunchAuthorization={requestId:bigint;authorization:`0x${string}`};
/** Fixture Core accepts an empty signature. Public chains need the OpenFour signer service, which is not integrated yet. */
export async function authorizeLaunch(d:Pick<Deployment,'fixture'>):Promise<LaunchAuthorization> {
  if(!d.fixture) throw Error('Public launch authorization is not configured. Creation is disabled on this deployment.');
  return {requestId:newRequestId(),authorization:'0x'};
}
export async function loadDeployment(client:PublicClient, signal?:AbortSignal) {
  const response=await fetch(manifestUrl,{signal,cache:'no-store'});
  if(!response.ok) throw Error(`Deployment manifest unavailable for chain ${vaultChain.id}`);
  const d=parseDeployment(await response.json(),vaultChain.id);
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
export async function quoteCreate(client:PublicClient,d:Deployment,basket:{name:string;symbol:string;metadataURI:string;constituents:{token:Address;weightBps:number}[]},seed:bigint,liquidity:bigint){
  const blockNumber=await client.getBlockNumber({cacheTime:0});
  const outputs=await client.readContract({address:d.factory,abi:factoryAbi,functionName:'previewCreate',args:[basket,seed],blockNumber});
  const prices=await Promise.all(basket.constituents.map(a=>client.readContract({address:d.oracle,abi:oracleAbi,functionName:'price18',args:[a.token],blockNumber})));
  const total=outputs.reduce((sum,o,i)=>{const asset=d.assets.find(a=>a.address===getAddress(basket.constituents[i].token));if(!asset)throw Error('Unknown executable asset');return sum+o*prices[i]/10n**BigInt(asset.decimals);},0n);
  const lpShares=liquidity*10n**BigInt(18-d.settlementDecimals);
  if(total<=lpShares)throw Error('Liquidity must be smaller than acquired collateral value');
  return {outputs,creatorShares:total-lpShares,lpShares,total};
}
