// Local V5 fixture: every registry asset (66) gets a mock token, a USDT V2 pool, an adapter route
// and an oracle price, so any registry composition can launch on chain 31337.
// Prices: fixed defaults that match integration/market_fixture.py (ETH 2000, BTCB 80000, others 1),
// or the live price server when FIXTURE_PRICES_URL points at its /snapshot.
const fs=require("fs");const path=require("path");const hre=require("hardhat");
const {deployFixtureServices,deployFixtureCore}=require("./lib/indexfi-v5-fixture");

const STATIC_PRICES={632:2000n,751:80000n};
function registryAssets(){
  const source=fs.readFileSync(path.resolve(__dirname,"../../../frontend/apps/web/data/registry.generated.ts"),"utf8");
  const list=JSON.parse(source.slice(source.indexOf("= [")+2,source.lastIndexOf("]")+1));
  const selected=JSON.parse(fs.readFileSync(path.resolve(__dirname,"../../../backend/registry/selected.json"),"utf8"));
  const feeds=new Map(selected.assets.map(a=>[a.asset_id,a.feed_id]));
  if(list.length!==feeds.size||list.some(a=>feeds.get(a.id)!==a.feedId))throw new Error("Frontend registry is out of sync with backend/registry/selected.json");
  return list;
}
async function prices(ethers,assets){
  const url=process.env.FIXTURE_PRICES_URL;
  if(!url)return new Map(assets.map(a=>[a.feedId,(STATIC_PRICES[a.feedId]??1n)*10n**18n]));
  const response=await fetch(url);
  if(!response.ok)throw new Error(`Price snapshot unavailable at ${url} (HTTP ${response.status})`);
  const live=new Map((await response.json()).prices.map(p=>{
    const [whole,fraction=""]=String(p.price).split(".");
    return [p.feed_id,ethers.parseUnits(`${whole}.${fraction.slice(0,18)||"0"}`,18)];
  }));
  const missing=assets.filter(a=>!live.get(a.feedId));
  if(missing.length)throw new Error(`No live price for ${missing.map(a=>a.symbol).join(", ")}`);
  return live;
}
async function main(){
  const {ethers}=hre;
  const registry=registryAssets();const price=await prices(ethers,registry);
  const s=await deployFixtureServices(ethers,registry.map(a=>({symbol:a.symbol,name:a.name,decimals:a.decimals,price18:price.get(a.feedId)})));
  const core=await deployFixtureCore(ethers);const factory=await ethers.deployContract("IndexFiFactory",[core,1,s.adapter,s.oracle,s.router,1_000_000_000n*10n**18n]);
  await factory.waitForDeployment();const receipt=await factory.deploymentTransaction().wait();
  const assets=await Promise.all(registry.map(async(a,i)=>({address:await s.tokens[i].getAddress(),symbol:a.symbol,decimals:a.decimals,referenceAssetId:a.id,feedId:a.feedId,isMock:true})));
  const manifest={schemaVersion:5,fixture:true,chainId:31337,factory:await factory.getAddress(),deploymentBlock:receipt.blockNumber,
    settlementToken:await s.usdt.getAddress(),settlementDecimals:6,adapter:await s.adapter.getAddress(),oracle:await s.oracle.getAddress(),router:await s.router.getAddress(),
    localCore:await core.getAddress(),supplyModel:"standard-openfour-inventory",fixtureAccounts:{creator:s.creator.address,depositor:s.investor.address},
    priceSource:process.env.FIXTURE_PRICES_URL?"live-snapshot":"static",assets};
  const dir=path.resolve(__dirname,"../deployments");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"31337.json"),JSON.stringify(manifest,null,2)+"\n");
  for(const name of ["IndexFiFactory","IndexFiVault","OpenFourToken","PancakeV2BasketAdapter","AtlasPushOracle"]){
    fs.writeFileSync(path.join(dir,`${name}.abi.json`),JSON.stringify((await hre.artifacts.readArtifact(name)).abi,null,2)+"\n");
  }
  console.log(JSON.stringify({...manifest,assets:`${assets.length} executable assets (${manifest.priceSource} prices)`},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
