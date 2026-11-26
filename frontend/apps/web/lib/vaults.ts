import {decodeEventLog, erc20Abi, formatUnits, getAddress, isAddress, parseAbi, parseUnits, type Address, type PublicClient, type TransactionReceipt} from 'viem';
import {bscTestnet, hardhat} from 'viem/chains';
import {z} from 'zod';
import {referenceAssetById} from './catalog';

const selectedChain = process.env.NEXT_PUBLIC_VAULT_CHAIN_ID || '97';
if (!['31337', '97'].includes(selectedChain)) throw Error('Unsupported vault chain');
export const vaultChain = selectedChain === '31337' ? hardhat : bscTestnet;
export const vaultRpc = process.env.NEXT_PUBLIC_VAULT_RPC_URL ||
  (vaultChain.id === 31337 ? 'http://127.0.0.1:8545' : process.env.NEXT_PUBLIC_BSC_TESTNET_RPC_URL);
export const manifestUrl = process.env.NEXT_PUBLIC_VAULT_MANIFEST_URL || `/deployments/${vaultChain.id}.json`;
const address = z.string().refine(x => isAddress(x)).transform(x => getAddress(x));
const decimals = z.number().int().min(0).max(77);
const token = z.object({address, symbol:z.string().min(1), decimals, referenceAssetId:z.string(), feedId:z.number().int().positive()});
const deployment = z.object({
  chainId:z.number().int(), factory:address, deploymentBlock:z.number().int().nonnegative(),
  settlementToken:address, settlementDecimals:decimals, adapter:address, assets:z.array(token).min(1),
});
export type Deployment = z.infer<typeof deployment>;
export function parseDeployment(input:unknown, chainId:number):Deployment {
  const d = deployment.parse(input);
  if(d.chainId !== chainId) throw Error('Deployment chain mismatch');
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
  'function minimumSeed() view returns (uint256)', 'function settlementToken() view returns (address)',
  'function vaultCount() view returns (uint256)', 'function vaultAt(uint256 index) view returns (address)',
  'function previewCreate(Basket basket,uint256 seedUSDT) view returns (uint256[] tokenOut)',
  'function createVault(Basket basket,uint256 seedUSDT,uint256[] minTokenOut,uint256 deadline,bytes launchAuthorization) payable returns (address vault,uint256 seedShares)',
  'event VaultCreated(address indexed creator,address indexed vault,uint256 seedUSDT)',
]);
export const vaultAbi = parseAbi([constituent,
  'function name() view returns (string)', 'function symbol() view returns (string)', 'function creator() view returns (address)',
  'function totalSupply() view returns (uint256)', 'function closed() view returns (bool)',
  'function balanceOf(address holder) view returns (uint256)', 'function costBasisUSDT(address holder) view returns (uint256)',
  'function constituents() view returns (Constituent[])',
  'function previewDeposit(uint256 usdtIn) view returns (uint256 shares,uint256[] tokenOut)',
  'function previewRedeem(address holder,uint256 shares) view returns (uint256 grossUSDT,uint256 creatorFeeUSDT,uint256 netUSDT)',
  'function deposit(uint256 usdtIn,uint256 minSharesOut,uint256[] minTokenOut,uint256 deadline) returns (uint256 shares)',
  'function redeem(uint256 shares,uint256 minNetUSDT,uint256 deadline) returns (uint256 netUSDT,uint256 creatorFeeUSDT)',
  'event Deposited(address indexed holder,uint256 usdtIn,uint256 shares)',
  'event Redeemed(address indexed holder,uint256 shares,uint256 basisUSDT,uint256 grossUSDT,uint256 creatorFeeUSDT,uint256 netUSDT)',
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
export async function loadDeployment(client:PublicClient, signal?:AbortSignal) {
  const response=await fetch(manifestUrl,{signal,cache:'no-store'});
  if(!response.ok) throw Error(`Deployment manifest unavailable for chain ${vaultChain.id}`);
  const d=parseDeployment(await response.json(),vaultChain.id);
  const [rpcChain,usdt,precision]=await Promise.all([client.getChainId(),
    client.readContract({address:d.factory,abi:factoryAbi,functionName:'settlementToken'}),
    client.readContract({address:d.settlementToken,abi:erc20Abi,functionName:'decimals'})]);
  if(rpcChain!==d.chainId || getAddress(usdt)!==d.settlementToken || precision!==d.settlementDecimals) throw Error('RPC deployment does not match the manifest');
  return d;
}
export async function listVaults(client:PublicClient,d:Deployment) {
  const blockNumber=await client.getBlockNumber({cacheTime:0});
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
  const config={address,abi:vaultAbi,blockNumber} as const;
  const [name,symbol,creator,closed,supply,legs,shares,basis]=await Promise.all([
    client.readContract({...config,functionName:'name'}),client.readContract({...config,functionName:'symbol'}),
    client.readContract({...config,functionName:'creator'}),client.readContract({...config,functionName:'closed'}),
    client.readContract({...config,functionName:'totalSupply'}),client.readContract({...config,functionName:'constituents'}),
    holder ? client.readContract({...config,functionName:'balanceOf',args:[holder]}) : 0n,
    holder ? client.readContract({...config,functionName:'costBasisUSDT',args:[holder]}) : 0n,
  ]);
  const holdings=await Promise.all(legs.map(async leg=>{
    const token=d.assets.find(a=>a.address===getAddress(leg.token));
    if(!token) throw Error('Vault contains a token outside the deployment manifest');
    const balance=await client.readContract({address:token.address,abi:erc20Abi,functionName:'balanceOf',args:[address],blockNumber});
    return {...token,weightBps:leg.weightBps,balance};
  }));
  return {address,name,symbol,creator,closed,supply,shares,basis,holdings,blockNumber};
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
