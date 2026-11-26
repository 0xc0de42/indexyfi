const hre=require("hardhat");const fs=require("fs");const path=require("path");
const {connectFork,loadRegistration}=require("./lib/demo");
const {deployFixtureServices}=require("./lib/indexfi-v5-fixture");
const output=path.resolve(__dirname,"../out/indexfi-v5-fork-fixture.json");
async function main(){
  const {ethers}=hre;
  if((await ethers.provider.getNetwork()).chainId!==31337n) throw new Error("V5 compatibility experiment is local-only");
  const {signer,chainId,addresses}=await connectFork(hre);
  if(process.env.STEP==="prepare"){
    if(!process.env.PRESET_ID)throw new Error("Set unused PRESET_ID before factory deployment");
    const s=await deployFixtureServices(ethers);
    const f=await ethers.deployContract("IndexFiFactory",[addresses.core,BigInt(process.env.PRESET_ID),s.adapter,s.oracle,s.router,1_000_000_000n*10n**18n]);
    await f.waitForDeployment();const data={factory:await f.getAddress(),presetId:process.env.PRESET_ID,core:addresses.core,usdt:await s.usdt.getAddress(),eth:await s.eth.getAddress(),btc:await s.btc.getAddress(),oracle:await s.oracle.getAddress()};
    fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(data,null,2));console.log(data);return;
  }
  if(process.env.STEP!=="launch")throw new Error("Choose STEP=prepare or STEP=launch");
  const data=JSON.parse(fs.readFileSync(output,"utf8"));const {registration}=loadRegistration("indexfi");
  if(data.core.toLowerCase()!==addresses.core.toLowerCase()||BigInt(registration.presetId)!==BigInt(data.presetId)||registration.registry.toLowerCase()!==addresses.registry.toLowerCase())throw new Error("Registration mismatch");
  const f=await ethers.getContractAt("IndexFiFactory",data.factory,signer);const cash=await ethers.getContractAt("MockAsset",data.usdt,signer);
  const basket={name:"IndexFi V5 Fork Experiment",symbol:"IV5",metadataURI:"",constituents:[{token:data.eth,weightBps:5000},{token:data.btc,weightBps:5000}]};
  const seed=100n*10n**6n,liq=10n*10n**6n;const deadline=BigInt((await ethers.provider.getBlock("latest")).timestamp+600);
  const fee=BigInt(process.env.CREATE_FEE_WEI||"0");const mins=Array.from(await f.previewCreate(basket,seed),x=>x*99n/100n);
  const requestId=BigInt(process.env.REQUEST_ID||Date.now());
  const args=await f.buildCreateArgs(requestId,signer.address,basket,seed,liq,0,mins,deadline,fee);
  const payload=ethers.solidityPacked(["string","uint256","address","bytes32"],["createOpenFourToken",chainId,data.factory,ethers.keccak256(args)]);
  const sig=await signer.signMessage(ethers.getBytes(ethers.keccak256(payload)));
  await (await cash.approve(f,seed+liq)).wait();
  const call=[requestId,basket,seed,liq,0,mins,deadline,sig,{value:fee}];
  await f.createVault.staticCall(...call);const tx=await f.createVault(...call);const r=await tx.wait();
  const v=await ethers.getContractAt("IndexFiVault",await f.vaultAt((await f.vaultCount())-1n));
  const t=await ethers.getContractAt("OpenFourToken",await v.token());const p=await ethers.getContractAt("MockV2Pair",await v.pair());
  if(await v.phase()!==3n||await v.creator()!==signer.address||await p.balanceOf(signer.address)===0n||await v.nav()!==10n**18n)throw new Error("Launch invariants failed");
  const before=await v.outstandingSupply();const deposit=2n*10n**6n;
  await(await cash.approve(v,deposit)).wait();const [quote,outs]=await v.previewDeposit(deposit);
  await(await v.deposit(deposit,quote*99n/100n,Array.from(outs,x=>x*99n/100n),deadline)).wait();
  const acquired=(await v.outstandingSupply())-before;await(await t.approve(v,acquired)).wait();
  await(await v.redeem(acquired,0,new Array(basket.constituents.length).fill(0),deadline)).wait();if(await v.outstandingSupply()!==before)throw new Error("Inventory mismatch");
  console.log(JSON.stringify({status:"local-real-core-experiment-passed",tx:r.hash,vault:await v.getAddress(),token:await t.getAddress(),pair:await p.getAddress(),creator:await v.creator()},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
