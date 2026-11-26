const fs=require("fs");const path=require("path");const hre=require("hardhat");
const {deployFixtureServices,deployFixtureCore}=require("./lib/indexfi-v5-fixture");
async function main(){
  const {ethers}=hre;const s=await deployFixtureServices(ethers);
  const core=await deployFixtureCore(ethers);const factory=await ethers.deployContract("IndexFiFactory",[core,1,s.adapter,s.oracle,s.router,1_000_000_000n*10n**18n]);
  await factory.waitForDeployment();const receipt=await factory.deploymentTransaction().wait();
  const manifest={schemaVersion:5,fixture:true,chainId:31337,factory:await factory.getAddress(),deploymentBlock:receipt.blockNumber,
    settlementToken:await s.usdt.getAddress(),settlementDecimals:6,adapter:await s.adapter.getAddress(),oracle:await s.oracle.getAddress(),router:await s.router.getAddress(),
    localCore:await core.getAddress(),supplyModel:"standard-openfour-inventory",fixtureAccounts:{creator:s.creator.address,depositor:s.investor.address},
    assets:[{address:await s.eth.getAddress(),symbol:"ETH",decimals:18,referenceAssetId:"56:0x2170ed0880ac9a755fd29b2688956bd959f933f8",feedId:632,isMock:true},
      {address:await s.btc.getAddress(),symbol:"BTCB",decimals:8,referenceAssetId:"56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",feedId:751,isMock:true}]};
  const dir=path.resolve(__dirname,"../deployments");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"31337.json"),JSON.stringify(manifest,null,2)+"\n");
  for(const name of ["IndexFiFactory","IndexFiVault","OpenFourToken","PancakeV2BasketAdapter","AtlasPushOracle"]){
    fs.writeFileSync(path.join(dir,`${name}.abi.json`),JSON.stringify((await hre.artifacts.readArtifact(name)).abi,null,2)+"\n");
  }
  console.log(JSON.stringify(manifest,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
