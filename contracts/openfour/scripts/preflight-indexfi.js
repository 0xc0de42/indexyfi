// Read-only public-chain preflight. Does not deploy or submit transactions.
const hre=require("hardhat");const fs=require("fs");
async function main(){
  const {ethers}=hre;const provider=ethers.provider;const network=await provider.getNetwork();
  if(network.chainId!==97n)throw new Error("Expected BSC Testnet chain 97");
  const c=JSON.parse(fs.readFileSync(process.env.INDEXFI_CHAIN_CONFIG||"chain97.config.json","utf8"));
  const address=(x,label)=>{if(!ethers.isAddress(x)||x===ethers.ZeroAddress)throw new Error(`Invalid ${label}`);return ethers.getAddress(x);};
  const code=async(x,label)=>{const a=address(x,label);if(await provider.getCode(a)==="0x")throw new Error(`No contract: ${label}`);return a;};
  const cash=await code(c.settlementToken,"settlementToken");const routerAddr=await code(c.router,"router");const coreAddr=await code(c.core,"OpenFour Core");
  const core=new ethers.Contract(coreAddr,["function registry() view returns(address)","function signer() view returns(address)"],provider);
  const registry=await code(await core.registry(),"registry");const signer=address(await core.signer(),"signer");
  const router=new ethers.Contract(routerAddr,["function factory() view returns(address)","function getAmountsOut(uint256,address[]) view returns(uint256[])"],provider);
  const factoryAddr=await code(await router.factory(),"Pancake factory");
  const factory=new ethers.Contract(factoryAddr,["function getPair(address,address) view returns(address)"],provider);
  const erc20=["function decimals() view returns(uint8)","function symbol() view returns(string)"];
  const dec=Number(await new ethers.Contract(cash,erc20,provider).decimals());if(dec>18)throw new Error("Unsupported USDT decimals");
  const now=BigInt((await provider.getBlock("latest")).timestamp);const rows=[];const seen=new Set();
  for(const asset of c.assets){
    const a=await code(asset.token,"asset");if(seen.has(a)||a===cash)throw new Error("Duplicate asset or redundant USDT feed");seen.add(a);
    const d=Number(await new ethers.Contract(a,erc20,provider).decimals());if(d>18)throw new Error("Unsupported decimals");
    if(!Number.isSafeInteger(asset.maxAge)||asset.maxAge<=0||asset.maxAge>2**32-1)throw new Error("Invalid maxAge");
    const feedAddr=await code(asset.aggregator,"Atlas feed");
    const feed=new ethers.Contract(feedAddr,["function isOpenRead() view returns(bool)","function decimals() view returns(uint8)","function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)"],provider);
    if(!await feed.isOpenRead())throw new Error("Atlas read authorization required before deployment");
    const fd=Number(await feed.decimals());const [round,p,src,updated,answered]=await feed.latestRoundData();
    if(fd>18||p<=0n||round===0n||answered<round||src===0n||src>updated||updated>now||now-src>BigInt(asset.maxAge)||now-updated>BigInt(asset.maxAge))throw new Error("Invalid or stale oracle");
    const path=asset.buyPath.map(x=>address(x,"path"));if(path.length<2||path.length>4||path[0]!==cash||path.at(-1)!==a||new Set(path).size!==path.length)throw new Error("Invalid route");
    for(let i=1;i<path.length;i++)await code(await factory.getPair(path[i-1],path[i]),"route pool");
    const input=10n*10n**BigInt(dec);const out=(await router.getAmountsOut(input,path)).at(-1);if(out===0n)throw new Error("Zero acquisition quote");
    const back=(await router.getAmountsOut(out,[...path].reverse())).at(-1);if(back===0n)throw new Error("Zero liquidation quote");
    rows.push({asset:a,decimals:d,feed:feedAddr,price18:(p*10n**BigInt(18-fd)).toString(),buyOut:out.toString(),roundTripUSDT:back.toString()});
  }
  if(!rows.length)throw new Error("No executable assets");
  console.log(JSON.stringify({chainId:97,core:coreAddr,registry,signer,router:routerAddr,settlement:cash,settlementDecimals:dec,assets:rows,warning:"Read-only checks; address provenance, caller entitlements, actual execution, Core fees and deployment still require verification."},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
