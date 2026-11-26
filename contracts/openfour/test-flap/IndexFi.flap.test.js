const {expect}=require('chai');
const {ethers,artifacts}=require('hardhat');
const E6=10n**6n,E18=10n**18n;
const expiry=async()=>BigInt((await ethers.provider.getBlock('latest')).timestamp+600);
const salt=(n=1)=>ethers.zeroPadValue(ethers.toBeHex(n),32);
async function fixture({cap=1000n*E18, multiplier=1, cashBasket=false,buyTax=100,sellTax=0,taxDuration=86400*30,antiFarmerDuration=0,decimals=6,signed=false}={}) {
 const [owner,creator,investor,other]=await ethers.getSigners();
 const unit=10n**BigInt(decimals); const usdt=await ethers.deployContract('MockAsset',['USDT','USD',decimals]);
 const asset=await ethers.deployContract('MockAsset',['Ether','ETH',18]);
 const oracle=await ethers.deployContract(signed?'MockSignedFlapOracle':'MockIndexFiOracle',[usdt]); if(signed)await oracle.allow(asset);else await oracle.setPrice(asset,2000n*E18);
 const adapter=await ethers.deployContract('MockIndexFiAdapter',[usdt]); await adapter.setPrice(asset,2000n*unit);
 await asset.mint(adapter,10000n*E18); await usdt.mint(adapter,1000000n*unit);
 const dex=await ethers.deployContract('MockV2Factory'); const router=await ethers.deployContract('MockV2Router',[dex]);
 const dock=await ethers.deployContract('MockFlapDock'); const portal=await ethers.deployContract('MockFlapPortal',[dex]);
 const implementation=await ethers.deployContract('IndexFiFlapVault');
 const factory=await ethers.deployContract('IndexFiFlapFactory',[{vaultImplementation:await implementation.getAddress(),portal:await portal.getAddress(),dock:await dock.getAddress(),guardian:owner.address,adapter:await adapter.getAddress(),oracle:await oracle.getAddress(),router:await router.getAddress(),cap,buyTax,sellTax,taxDuration,antiFarmerDuration,dexId:0}]);
 await portal.setLauncherFactoryMultiplier(factory,multiplier,true);
 for(const signer of [creator,investor,other])await usdt.mint(signer.address,10000n*unit);
 const basket={name:'IndexFi ETH',symbol:'IDX',metadataURI:'ipfs://fixture',constituents:cashBasket?[{token:await usdt.getAddress(),weightBps:10000}]:[{token:await asset.getAddress(),weightBps:5000},{token:await usdt.getAddress(),weightBps:5000}]};
 await usdt.connect(creator).approve(factory,ethers.MaxUint256);
 let sequence=0;
 async function launch({requestId=++sequence,payloads,signatures,seed=100n*unit,liq=20n*unit,min=0n,auth=salt(),minimums,deadline}={}) {
   minimums=minimums??Array.from(await factory.previewCreate(basket,seed));
   const args=[requestId,basket,seed,liq,min,minimums,deadline??await expiry(),auth]; const tx=payloads?await factory.connect(creator).createVaultWithPrices(payloads,signatures,...args):await factory.connect(creator).createVault(...args);const receipt=await tx.wait();
   const event=receipt.logs.map(l=>{try{return factory.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='PortfolioLaunched');
   const v=await ethers.getContractAt('IndexFiFlapVault',event.args.vault); const token=await ethers.getContractAt('MockFlapToken',event.args.token); const pair=await ethers.getContractAt('MockV2Pair',event.args.pair);
   return {v,token,pair,receipt};
 }
 return {owner,creator,investor,other,usdt,asset,oracle,adapter,dex,router,dock,portal,factory,basket,cap,launch};
}
async function deposit(s,v,amount=10n*E6){await s.usdt.connect(s.investor).approve(v,amount);const [shares,outputs]=await v.previewDeposit(amount);await v.connect(s.investor).deposit(amount,shares,Array.from(outputs),await expiry());return shares;}
async function redeem(s,v,token,amount){await token.connect(s.investor).approve(v,amount);const [,fee,net]=await v.previewRedeem(s.investor.address,amount);await v.connect(s.investor).redeem(amount,net,Array.from((await v.previewRedeemAssets(s.investor.address,amount))[1]),await expiry());return {fee,net};}
async function invariant(s,v,token){expect((await v.outstandingSupply())+(await v.inventory())).to.equal(await token.totalSupply());expect(await s.dock.balanceOf(token,v)).to.equal(await v.inventory());expect(await token.balanceOf(v)).to.equal(0n);}
describe('IndexFi Flap (local Portal and Token Dock fixtures only)',function(){
 it('keeps every current shared factory/vault method and event ABI-compatible',async()=>{
  for(const [oldName,newName] of [['IIndexFiFactory','IndexFiFlapFactory'],['IIndexFiVault','IndexFiFlapVault']]){
   const old=new ethers.Interface((await artifacts.readArtifact(oldName)).abi);const next=new ethers.Interface((await artifacts.readArtifact(newName)).abi);
   for(const f of old.fragments.filter(f=>f.type==='function'||f.type==='event')){
    const g=f.type==='function'?next.getFunction(f.format('sighash')):next.getEvent(f.format('sighash'));expect(g, f.format()).not.to.equal(null);
    expect(g.format('sighash')).to.equal(f.format('sighash'));
    if(f.type==='function'){expect(g.selector).to.equal(f.selector);expect(g.outputs.map(x=>x.format('sighash'))).to.deep.equal(f.outputs.map(x=>x.format('sighash')));expect(g.stateMutability).to.equal(f.stateMutability);}
    else {expect(g.topicHash).to.equal(f.topicHash);expect(g.inputs.map(x=>x.indexed)).to.deep.equal(f.inputs.map(x=>x.indexed));}
   }
  }
  for(const [oldName,newName,names] of [['IndexFiFactory','IndexFiFlapFactory',['createVaultWithPrices','quoteCreateWithPrices','minimumLiquidity','router','oracle','adapter']],['IndexFiVault','IndexFiFlapVault',['depositWithPrices','quoteDepositWithPrices','redeemWithPrices','redeemInKindWithPrices']]]){
   const a=new ethers.Interface((await artifacts.readArtifact(oldName)).abi),b=new ethers.Interface((await artifacts.readArtifact(newName)).abi);
   for(const n of names){const x=a.getFunction(n),y=b.getFunction(n);expect(y.selector).to.equal(x.selector);expect(y.outputs.map(i=>i.format('sighash'))).to.deep.equal(x.outputs.map(i=>i.format('sighash')));expect(y.stateMutability).to.equal(x.stateMutability);}
  }
  const old=new ethers.Interface((await artifacts.readArtifact('IndexFiVault')).abi),next=new ethers.Interface((await artifacts.readArtifact('IndexFiFlapVault')).abi);
  for(const name of ['token','pair','phase','outstandingSupply','inventory','factory','router','adapter','oracle','reservedShares','reservedUSDT'])expect(next.getFunction(name).selector).to.equal(old.getFunction(name).selector);
 });
 it('creates backed shares, initializes pool at NAV, locks every initial LP and deposits reserve in vault-owned Dock',async()=>{
  const s=await fixture();const {v,token,pair}=await s.launch();expect(await s.factory.vaultCount()).to.equal(1n);expect(await s.factory.vaultAt(0)).to.equal(await v.getAddress());
  expect(await s.factory.isVault(v)).to.equal(true);expect(await s.factory.usedRequestIds(1)).to.equal(true);expect(await v.creator()).to.equal(s.creator.address);expect(await v.name()).to.equal(s.basket.name);expect(await v.phase()).to.equal(3n);expect(await v.nav()).to.equal(E18);
  expect(await v.collateralValue()).to.equal(100n*E18);expect(await v.totalSupply()).to.equal(100n*E18);expect(await token.balanceOf(s.creator.address)).to.equal(80n*E18);expect(await token.balanceOf(pair)).to.equal(20n*E18);
  expect(await s.usdt.balanceOf(pair)).to.equal(20n*E6);expect(await pair.balanceOf(s.creator.address)).to.equal(0n);expect(await pair.balanceOf('0x000000000000000000000000000000000000dEaD')).to.equal(await pair.totalSupply());
  expect(await v.inventory()).to.equal(900n*E18);expect(await v.collateralBalance(s.usdt)).to.equal(50n*E6);await invariant(s,v,token);
  expect(await s.portal.getLauncher(await v.launcher())).to.deep.equal([await s.factory.getAddress()]);expect(await s.portal.launchCount()).to.equal(1n);
  const launcher=await ethers.getContractAt('IndexFiFlapLauncher',await v.launcher()); const desc=JSON.parse(await launcher.description());
  expect(desc.name).to.equal(s.basket.name);expect(desc.symbol).to.equal(s.basket.symbol);expect(desc.quoteToken.toLowerCase()).to.equal((await s.usdt.getAddress()).toLowerCase());expect(desc.poolTokenRatio).to.equal((2n*10n**16n).toString());
 });
 it('repeatedly releases and returns Dock inventory, charges 10 bps, and redeems without oracle',async()=>{
  const s=await fixture({cashBasket:true});const {v,token}=await s.launch();
  for(let i=0;i<3;i++){
   const creatorBefore=await s.usdt.balanceOf(s.creator.address);const issued=await deposit(s,v);expect(issued).to.equal(999n*E18/100n);expect(await s.usdt.balanceOf(s.creator.address)-creatorBefore).to.equal(10000n);expect(await v.nav()).to.equal(E18);await invariant(s,v,token);
   await s.oracle.setUnavailable(true);await expect(v.previewDeposit(E6)).to.be.revertedWith('Mock oracle unavailable');const {fee,net}=await redeem(s,v,token,issued);expect(fee).to.equal(9990n);expect(net).to.equal(9980010n);expect(await v.outstandingSupply()).to.equal(100n*E18);await invariant(s,v,token);await s.oracle.setUnavailable(false);
  }
 });
 it('keeps backing unchanged through a taxed secondary trade',async()=>{
  const s=await fixture();const {v,token,pair}=await s.launch();const before=await v.collateralValue(),supply=await v.outstandingSupply();
  const path=[await s.usdt.getAddress(),await token.getAddress()];const gross=(await s.router.getAmountsOut(E6,path))[1];
  await s.usdt.connect(s.investor).approve(s.router,E6);await s.router.connect(s.investor).swapExactTokensForTokens(E6,0,path,s.investor.address,await expiry());
  expect(await token.balanceOf(s.investor.address)).to.equal(gross-gross*100n/10000n);expect(await v.collateralValue()).to.equal(before);expect(await v.outstandingSupply()).to.equal(supply);await invariant(s,v,token);
  // This mock router does not provide tax-aware slippage protection. Not a production swap path.
  expect(await pair.balanceOf(s.creator.address)).to.equal(0n);
 });
 it('accepts zero multiplier and rejects disabled/high-floor launches atomically',async()=>{
  const s=await fixture();const before=await s.usdt.balanceOf(s.creator.address);
  await s.portal.setLauncherFactoryMultiplier(s.factory,0,true);await s.launch();
  const after=await s.usdt.balanceOf(s.creator.address);
  await s.portal.setLauncherFactoryMultiplier(s.factory,1,false);await expect(s.launch()).to.be.rejectedWith('Flap: factory configuration');
  await s.portal.setLauncherFactoryMultiplier(s.factory,10000,true);await expect(s.launch({auth:salt(2)})).to.be.rejectedWith('Portal: floor');
  expect(await s.usdt.balanceOf(s.creator.address)).to.equal(after);expect(await s.factory.vaultCount()).to.equal(1n);expect(await s.portal.launchCount()).to.equal(1n);
 });
 it('rolls back seed swaps and directory on missing burned LP or Portal failure',async()=>{
  const s=await fixture();const cash=await s.usdt.balanceOf(s.creator.address),asset=await s.asset.balanceOf(s.adapter);
  await s.portal.configure(true,0,false);await expect(s.launch()).to.be.rejected;await s.portal.configure(false,0,true);await expect(s.launch()).to.be.rejectedWith('Portal: launch rejected');
  expect(await s.usdt.balanceOf(s.creator.address)).to.equal(cash);expect(await s.asset.balanceOf(s.adapter)).to.equal(asset);expect(await s.factory.vaultCount()).to.equal(0n);expect(await s.portal.launchCount()).to.equal(0n);
 });
 it('rejects taxed ordinary transfers at launch and rolls back post-launch deposit/redeem',async()=>{
  const s=await fixture();await s.portal.configure(false,100,false);await expect(s.launch()).to.be.rejected;expect(await s.factory.vaultCount()).to.equal(0n);
  await s.portal.configure(false,0,false);const {v,token}=await s.launch();const issued=await deposit(s,v);const inv=await v.inventory(),cash=await s.usdt.balanceOf(s.investor.address),collateral=await v.collateralValue();
  await s.portal.setOrdinaryTax(token,100);await expect(deposit(s,v)).to.be.rejected;await expect(redeem(s,v,token,issued)).to.be.rejected;
  expect(await s.usdt.balanceOf(s.investor.address)).to.equal(cash);expect(await v.collateralValue()).to.equal(collateral);expect(await v.inventory()).to.equal(inv);await invariant(s,v,token);
 });
 it('rolls back on failed Dock operations and inadequate slippage bounds',async()=>{
  const s=await fixture();const {v,token}=await s.launch();const issued=await deposit(s,v);const cash=await s.usdt.balanceOf(s.investor.address),collateral=await v.collateralValue();
  await s.dock.setReject(false,true);await expect(deposit(s,v)).to.be.rejectedWith('Dock: rejected withdrawal');
  await s.dock.setReject(true,false);await expect(redeem(s,v,token,issued)).to.be.rejectedWith('Dock: rejected deposit');
  await s.dock.setReject(false,false);await expect(v.connect(s.investor).redeem(issued,ethers.MaxUint256,[0,0],await expiry())).to.be.revertedWithCustomError(v,'Slippage');
  expect(await s.usdt.balanceOf(s.investor.address)).to.equal(cash);expect(await v.collateralValue()).to.equal(collateral);await invariant(s,v,token);
 });
 it('rejects spoofed registration, callbacks, unauthorized custody operations and launcher upgrades',async()=>{
  const s=await fixture();const {v,token}=await s.launch();
  await expect(s.factory.newLauncher(s.creator.address,'0x')).to.be.revertedWithCustomError(s.factory,'NotHub');
  await expect(s.portal.connect(s.other).newLauncher(s.factory,ethers.AbiCoder.defaultAbiCoder().encode(['address'],[s.creator.address]))).to.be.revertedWith('Flap: use createVault');
  await expect(v.initializeDistribution(token,1,'0x',salt())).to.be.revertedWithCustomError(v,'InvalidLaunch');
  await expect(v.acquire(100n*E6,20n*E6,0,[0,0],await expiry())).to.be.revertedWithCustomError(v,'Unauthorized');
  await expect(s.dock.connect(s.other).withdraw(token,1,s.other.address)).to.be.reverted;
  await expect(s.factory.connect(s.other).upgradeVaultImplementation(token)).to.be.revertedWithCustomError(s.factory,'NotGuardian');
  await expect(s.factory.upgradeVaultImplementation(token)).to.be.revertedWith('Flap: immutable launchers');
 });
 it('enforces finite reserve, deadline, seed and creator minimum, and rejects duplicate salt',async()=>{
  const s=await fixture({cap:105n*E18});const {v,token}=await s.launch();await expect(deposit(s,v)).to.be.rejected;
  await expect(s.launch({seed:99n*E6,auth:salt(2)})).to.be.rejected;await expect(s.launch({min:81n*E18,auth:salt(2)})).to.be.rejected;
  await expect(s.launch({deadline:1n,auth:salt(2)})).to.be.rejectedWith('Flap: funding');await expect(s.launch()).to.be.rejectedWith('Portal: unauthorized');
  expect(await s.factory.vaultCount()).to.equal(1n);await invariant(s,v,token);
 });
 it('binds native factory and rejects unauthorized callback and upgrades',async()=>{
  const s=await fixture({multiplier:0});const {v,token}=await s.launch();const vf=await ethers.getContractAt('IndexFiFlapVaultFactory',await s.factory.vaultFactory());
  expect(await vf.factorySpecVersion()).to.equal('pl-v1');expect(await vf.launcherFactory()).to.equal(await s.factory.getAddress());expect(await s.portal.nativeVault(token)).to.equal(await v.getAddress());
  await expect(vf.connect(s.other).newVault(token,s.other.address,0,'0x')).to.be.revertedWith('Native: callback');
  await expect(vf.connect(s.other).prepare()).to.be.revertedWith('Native: launcher factory');
  await expect(vf.connect(s.other).upgradeVaultImplementation(token)).to.be.revertedWith('Native: guardian');
  await expect(vf.upgradeVaultImplementation(token)).to.be.revertedWith('Native: immutable vaults');
 });
 it('forwards quote surplus without withdrawing collateral',async()=>{
  const s=await fixture();const {v}=await s.launch();const backing=await v.collateralBalance(s.usdt);const balance=await s.usdt.balanceOf(s.creator.address);
  await s.usdt.mint(v,E6);await v.connect(s.other).forwardTaxRevenue();expect(await s.usdt.balanceOf(v)).to.equal(backing);expect(await s.usdt.balanceOf(s.creator.address)).to.equal(balance+E6);
 });
 it('enforces issuance deviation and supports oracle-free in-kind redemption',async()=>{
  const s=await fixture();const {v,token}=await s.launch();const issued=await deposit(s,v);
  await s.oracle.setPrice(s.asset,1000n*E18);await expect(v.previewDeposit(E6)).to.be.revertedWithCustomError(v,'Slippage');
  await s.oracle.setUnavailable(true);await token.connect(s.investor).approve(v,issued);const before=await s.asset.balanceOf(s.investor.address);
  await v.connect(s.investor).redeemInKind(issued,[0,0],await expiry());expect(await s.asset.balanceOf(s.investor.address)).to.be.gt(before);await invariant(s,v,token);
 });
 it('enforces explicit redemption leg limits and rolls back',async()=>{
  const s=await fixture();const {v,token}=await s.launch();const issued=await deposit(s,v);await token.connect(s.investor).approve(v,issued);
  await expect(v.connect(s.investor).redeem(issued,1,[ethers.MaxUint256,0],await expiry())).to.be.reverted;
  expect(await token.balanceOf(s.investor.address)).to.equal(issued);await invariant(s,v,token);
 });
 it('accepts zero and one second tax duration; next sell disables tax in fixture',async()=>{
  for(const duration of [0,1]){const s=await fixture({multiplier:0,taxDuration:duration});const {token,pair}=await s.launch();
   await ethers.provider.send('evm_increaseTime',[2]);await ethers.provider.send('evm_mine',[]);expect(await token.expired()).to.equal(false);
   await token.connect(s.creator).transfer(pair,E18);expect(await token.expired()).to.equal(true);}
 });
 it('launches 18-decimal USD with large reserve at zero multiplier',async()=>{
  const s=await fixture({decimals:18,cap:1000000000n*E18,multiplier:0,buyTax:0,sellTax:100,taxDuration:1});const {v,token,pair}=await s.launch();
  expect(await v.nav()).to.equal(E18);expect(await s.usdt.balanceOf(pair)).to.equal(20n*E18);expect(await v.inventory()).to.equal((1000000000n-100n)*E18);await invariant(s,v,token);
 });
 async function signedPrice(s,{price=2000n*E18,ts,signer=s.owner}={}){
  ts=ts??BigInt((await ethers.provider.getBlock('latest')).timestamp);
  const coder=ethers.AbiCoder.defaultAbiCoder();const payload=coder.encode(['address','uint256','uint256'],[await s.asset.getAddress(),price,ts]);
  const digest=ethers.keccak256(coder.encode(['uint256','address','bytes'],[31337,await s.oracle.getAddress(),payload]));
  return [[payload],[await signer.signMessage(ethers.getBytes(digest))]];
 }
 it('posts verified fixture prices atomically and preserves the creator and holder',async()=>{
  const s=await fixture({signed:true,multiplier:0,decimals:18});const [p,sig]=await signedPrice(s);
  const opaque=await s.factory.buildCreateArgs(1,s.creator.address,s.basket,100n*E18,20n*E18,0,[0,0],await expiry(),0);expect(opaque).not.to.equal('0x');
  const q=await s.factory.quoteCreateWithPrices.staticCall(p,sig,s.basket,100n*E18);expect(q.length).to.equal(2);expect(await s.oracle.prices(s.asset)).to.equal(0n);
  const {v,token,receipt}=await s.launch({payloads:p,signatures:sig});expect(await v.creator()).to.equal(s.creator.address);expect(await s.oracle.prices(s.asset)).to.equal(2000n*E18);
  const ev=receipt.logs.map(l=>{try{return s.factory.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='VaultCreated');expect(ev.args.requestId).to.equal(1n);
  await expect(s.factory.connect(s.creator).createVault(1,s.basket,100n*E18,20n*E18,0,[0,0],await expiry(),salt(2))).to.be.revertedWithCustomError(s.factory,'InvalidRequest');
  await s.usdt.connect(s.investor).approve(v,10n*E18);const [p2,s2]=await signedPrice(s);
  const [shares,outs]=await v.quoteDepositWithPrices.staticCall(p2,s2,10n*E18);await expect(v.connect(s.investor).depositWithPrices(p2,[],10n*E18,shares,Array.from(outs),await expiry())).to.be.revertedWithCustomError(v,'InvalidAmount');
  const oldTime=await s.oracle.timestamps(s.asset);await expect(v.connect(s.investor).depositWithPrices(p2,s2,10n*E18,ethers.MaxUint256,Array.from(outs),await expiry())).to.be.revertedWithCustomError(v,'Slippage');expect(await s.oracle.timestamps(s.asset)).to.equal(oldTime);
  await v.connect(s.investor).depositWithPrices(p2,s2,10n*E18,shares,Array.from(outs),await expiry());expect(await token.balanceOf(s.investor.address)).to.equal(shares);
  await token.connect(s.investor).approve(v,shares);const half=shares/2n;const [,legs]=await v.previewRedeemAssets(s.investor.address,half);const [,,net]=await v.previewRedeem(s.investor.address,half);
  await v.connect(s.investor).redeemWithPrices(p2,s2,half,net,Array.from(legs),await expiry());
  const [gross,fees,amounts]=await v.previewRedeemInKind(s.investor.address,shares-half);const [actualNet,actualFees]=await v.connect(s.investor).redeemInKindWithPrices.staticCall(p2,s2,shares-half,Array.from(amounts),await expiry());expect(actualNet).to.deep.equal(amounts);expect(actualFees).to.deep.equal(fees);expect(gross.length).to.equal(2);
  await expect(v.connect(s.investor).redeemInKindWithPrices(p2,s2,shares-half,Array.from(amounts),await expiry())).to.emit(v,'RedeemedAsset').and.to.emit(v,'RedeemedInKind');await invariant(s,v,token);
 });
 it('rejects malformed, forged and stale prices and rolls back updates on failed launch',async()=>{
  const s=await fixture({signed:true,multiplier:0});const [p,sig]=await signedPrice(s);
  await expect(s.factory.quoteCreateWithPrices(p,[],s.basket,100n*E6)).to.be.revertedWithCustomError(s.factory,'InvalidPrices');
  await expect(s.factory.quoteCreateWithPrices(Array(5).fill(p[0]),Array(5).fill(sig[0]),s.basket,100n*E6)).to.be.revertedWithCustomError(s.factory,'InvalidPrices');
  const [bad,bs]=await signedPrice(s,{signer:s.other});await expect(s.launch({payloads:bad,signatures:bs})).to.be.rejectedWith('fixture: bad signature');
  const [stale,ss]=await signedPrice(s,{ts:1n});await expect(s.launch({payloads:stale,signatures:ss})).to.be.rejectedWith('fixture: invalid price');
  await expect(s.launch({requestId:42,payloads:p,signatures:sig,min:1000n*E18})).to.be.rejected;expect(await s.oracle.prices(s.asset)).to.equal(0n);expect(await s.factory.usedRequestIds(42)).to.equal(false);
  const {v,token}=await s.launch({requestId:42,payloads:p,signatures:sig});const issued=await deposit(s,v);await token.connect(s.investor).approve(v,issued);await ethers.provider.send('evm_increaseTime',[301]);await ethers.provider.send('evm_mine',[]);
  await expect(v.previewDeposit(E6)).to.be.revertedWith('fixture: unavailable price');await redeem(s,v,token,issued);await invariant(s,v,token);
 });
});
