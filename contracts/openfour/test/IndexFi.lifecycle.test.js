const {expect} = require("chai");
const {ethers} = require("hardhat");
const e6 = 10n ** 6n, e18 = 10n ** 18n;
const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 600);

async function fixture({cap=1_000_000_000n*e18, realSwaps=false, cashBasket=false}={}) {
  const [owner, creator, investor, arb] = await ethers.getSigners();
  const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 6]);
  const eth = await ethers.deployContract("MockAsset", ["Ether", "ETH", 18]);
  const btc = await ethers.deployContract("MockAsset", ["Bitcoin", "BTCB", 8]);
  const oracle = await ethers.deployContract("MockIndexFiOracle", [usdt]);
  await oracle.setPrice(eth,2000n*e18); await oracle.setPrice(btc,80000n*e18);
  const dex = await ethers.deployContract("MockV2Factory");
  const router = await ethers.deployContract("MockV2Router", [dex]);
  let adapter;
  if(realSwaps) {
    for(const [asset,amount] of [[eth,10000n*e18],[btc,250n*10n**8n]]) {
      await dex.createPair(usdt,asset); const p=await dex.getPair(usdt,asset);
      await usdt.mint(p,20_000_000n*e6); await asset.mint(p,amount);
      await (await ethers.getContractAt("MockV2Pair",p)).mint(owner.address);
    }
    adapter=await ethers.deployContract("PancakeV2BasketAdapter",[usdt,router,
      [{asset:await eth.getAddress(),buyPath:[await usdt.getAddress(),await eth.getAddress()]},
       {asset:await btc.getAddress(),buyPath:[await usdt.getAddress(),await btc.getAddress()]}]]);
  } else {
    adapter=await ethers.deployContract("MockIndexFiAdapter",[usdt]);
    await adapter.setPrice(eth,2000n*e6); await adapter.setPrice(btc,80000n*e6);
    await eth.mint(adapter,10000n*e18); await btc.mint(adapter,1000n*10n**8n); await usdt.mint(adapter,10_000_000n*e6);
  }
  for(const who of [creator,investor,arb]) await usdt.mint(who.address,10000n*e6);
  const tokenImpl=await ethers.deployContract("OpenFourToken");
  const vaultImpl=await ethers.deployContract("IndexFiVault");
  const migrateImpl=await ethers.deployContract("IndexFiMigrateModule");
  const tokenModule=await ethers.deployContract("StandardTokenModule");
  const core=await ethers.deployContract("MockIndexFiCore",[tokenImpl,vaultImpl,migrateImpl,tokenModule]);
  const factory=await ethers.deployContract("IndexFiFactory",[core,7,adapter,oracle,router,cap]);
  const basket={name:"Blue Chip Basket",symbol:"BLUE",metadataURI:"ipfs://blue",constituents:[
    {token:await eth.getAddress(),weightBps:5000},
    {token:await (cashBasket?usdt:btc).getAddress(),weightBps:5000}]};
  return {owner,creator,investor,arb,usdt,eth,btc,oracle,dex,router,adapter,core,factory,basket,cap};
}
async function create(s,seed=100n*e6,liq=10n*e6,minCreator=0n) {
  await s.usdt.connect(s.creator).approve(s.factory,seed+liq);
  const min=Array.from(await s.factory.previewCreate(s.basket,seed));
  await s.factory.connect(s.creator).createVault(1,s.basket,seed,liq,minCreator,min,await deadline(),"0x");
  const v=await ethers.getContractAt("IndexFiVault",await s.factory.vaultAt(0));
  const token=await ethers.getContractAt("OpenFourToken",await v.token());
  const pair=await ethers.getContractAt("MockV2Pair",await v.pair());
  return {v,token,pair};
}
async function deposit(s,v,amount=100n*e6) {
  await s.usdt.connect(s.investor).approve(v,amount);
  const [shares,outputs]=await v.previewDeposit(amount);
  await v.connect(s.investor).deposit(amount,shares,Array.from(outputs),await deadline());
  return shares;
}
async function redeem(s,v,token,who,shares) {
  await token.connect(who).approve(v,shares);
  const [, ,net]=await v.previewRedeem(who.address,shares);
  const [,outputs]=await v.previewRedeemAssets(who.address,shares);
  await v.connect(who).redeem(shares,net,Array.from(outputs),await deadline());
  return net;
}
async function expectSolvent(s,v,token) {
  expect((await v.inventory())+(await v.outstandingSupply())).to.equal(s.cap);
  expect(await token.balanceOf(v)).to.be.gte(await v.inventory());
  for(const leg of await v.constituents()) {
    const asset=await ethers.getContractAt("MockAsset",leg.token);
    expect(await asset.balanceOf(v)).to.be.gte(await v.collateralBalance(leg.token));
  }
}

describe("IndexFi V5 standard OpenFour inventory lifecycle (fixture Core)",function(){
  it("uses the standard token, backs every LP share, transfers and graduates atomically",async function(){
    const s=await fixture();const {v,token,pair}=await create(s);
    expect(await token.totalSupply()).to.equal(s.cap);
    expect(await v.outstandingSupply()).to.equal(100n*e18);
    expect(await v.inventory()).to.equal(s.cap-100n*e18);
    expect(await token.balanceOf(s.creator.address)).to.equal(90n*e18);
    expect(await token.balanceOf(pair)).to.equal(10n*e18);
    expect(await s.usdt.balanceOf(pair)).to.equal(10n*e6);
    expect(await v.collateralValue()).to.equal(100n*e18);expect(await v.nav()).to.equal(e18);
    expect(await v.phase()).to.equal(3n);expect(await token.tokenPhase()).to.equal(3n);
    expect(await token.migratedPools(pair)).to.equal(true);
    expect(await pair.balanceOf(s.creator.address)).to.be.gt(0n);
    expect(await v.reservedUSDT()).to.equal(0n);expect(await v.reservedShares()).to.equal(0n);
    await token.connect(s.creator).transfer(s.investor.address,e18);
    expect(await v.outstandingSupply()).to.equal(100n*e18);
    expect(await token.balanceOf(s.investor.address)).to.equal(e18);
    expect(await s.factory.isVault(v)).to.equal(true);
  });
  it("uses explicit non-replayable request IDs without a shared next-ID race",async function(){
    const s=await fixture();await create(s);
    expect(await s.factory.usedRequestIds(1)).to.equal(true);
    const minimums=Array.from(await s.factory.previewCreate(s.basket,100n*e6));
    await expect(s.factory.buildCreateArgs(1,s.creator.address,s.basket,100n*e6,10n*e6,0,minimums,await deadline(),0))
      .to.be.revertedWith("IndexFi: request id");
    expect(await s.factory.buildCreateArgs(987654321,s.creator.address,s.basket,100n*e6,10n*e6,0,minimums,await deadline(),0))
      .to.not.equal("0x");
  });
  it("skims prefunded pair dust instead of allowing a predictable-address launch denial",async function(){
    const s=await fixture();
    const nonce=await ethers.provider.getTransactionCount(await s.core.getAddress());
    const predictedToken=ethers.getCreateAddress({from:await s.core.getAddress(),nonce});
    await s.dex.createPair(predictedToken,await s.usdt.getAddress());
    const predictedPair=await s.dex.getPair(predictedToken,await s.usdt.getAddress());
    await s.usdt.mint(predictedPair,1n);
    const {token,pair}=await create(s);
    expect(await token.getAddress()).to.equal(predictedToken);
    expect(await pair.getAddress()).to.equal(predictedPair);
    expect(await s.usdt.balanceOf(pair)).to.equal(10n*e6);
  });
  it("charges 10 bps and keeps NAV unchanged through issuance; redemption works without oracle",async function(){
    const s=await fixture();const {v,token}=await create(s);const before=await s.usdt.balanceOf(s.creator.address);
    const shares=await deposit(s,v);expect(shares).to.equal(998996n*10n**14n);
    expect(await s.usdt.balanceOf(s.creator.address)-before).to.equal(100000n);
    expect(await v.nav()).to.equal(e18);
    await s.oracle.setUnavailable(true);
    await expect(v.previewDeposit(10n*e6)).to.be.revertedWith("Mock oracle unavailable");
    const [gross,fee,net]=await v.previewRedeem(s.investor.address,shares);
    // BTC 8-decimal rounding may leave sub-cent dust; gross is actual executable preview.
    expect(fee).to.equal(gross*10n/10000n);expect(net).to.equal(gross-fee);
    await redeem(s,v,token,s.investor,shares);expect(await v.outstandingSupply()).to.equal(100n*e18);
  });
  it("enforces sell minimums and permits an oracle-free in-kind exit when one route is blocked",async function(){
    const s=await fixture();const {v,token}=await create(s);const shares=await deposit(s,v);
    await token.connect(s.investor).approve(v,shares);
    const [,expectedUSDT]=await v.previewRedeemAssets(s.investor.address,shares);
    await expect(v.connect(s.investor).redeem(shares,0,[expectedUSDT[0]+1n,0],await deadline()))
      .to.be.revertedWith("IndexFi: sell slippage");
    await s.adapter.setSellBlocked(s.eth,true);
    await expect(v.connect(s.investor).redeem(shares,0,[0,0],await deadline()))
      .to.be.revertedWith("IndexFi: sell blocked");
    await s.oracle.setUnavailable(true);
    const [gross,fees,net]=await v.previewRedeemInKind(s.investor.address,shares);
    expect(fees[0]).to.equal(gross[0]*10n/10000n);
    expect(fees[1]).to.equal(gross[1]*10n/10000n);
    const investorEth=await s.eth.balanceOf(s.investor.address);const investorBtc=await s.btc.balanceOf(s.investor.address);
    const creatorEth=await s.eth.balanceOf(s.creator.address);const creatorBtc=await s.btc.balanceOf(s.creator.address);
    await v.connect(s.investor).redeemInKind(shares,Array.from(net),await deadline());
    expect(await s.eth.balanceOf(s.investor.address)-investorEth).to.equal(net[0]);
    expect(await s.btc.balanceOf(s.investor.address)-investorBtc).to.equal(net[1]);
    expect(await s.eth.balanceOf(s.creator.address)-creatorEth).to.equal(fees[0]);
    expect(await s.btc.balanceOf(s.creator.address)-creatorBtc).to.equal(fees[1]);
    expect(await v.outstandingSupply()).to.equal(100n*e18);
  });
  it("charges actual swap losses to the new investor rather than diluting existing holders",async function(){
    const s=await fixture();const {v}=await create(s);await s.adapter.setExecutionBps(9000);
    const shares=await deposit(s,v);
    expect(shares).to.be.lt(90n*e18);expect(await v.nav()).to.be.gte(e18);
  });
  it("precomputes allocations from drifted weights, not initial weights",async function(){
    const s=await fixture();const {v}=await create(s);
    await s.oracle.setPrice(s.eth,4000n*e18);await s.adapter.setPrice(s.eth,4000n*e6);
    const ethBefore=await v.collateralBalance(s.eth);const btcBefore=await v.collateralBalance(s.btc);
    await deposit(s,v,150n*e6);
    const ethAdded=await v.collateralBalance(s.eth)-ethBefore;const btcAdded=await v.collateralBalance(s.btc)-btcBefore;
    expect(ethAdded).to.equal(24975n*10n**12n);expect(btcAdded).to.equal(62437n);
  });
  it("isolates USDT collateral from liquidity, donations and migration access",async function(){
    const s=await fixture({cashBasket:true});const {v,token,pair}=await create(s);
    expect(await v.collateralBalance(s.usdt)).to.equal(50n*e6);expect(await s.usdt.balanceOf(v)).to.equal(50n*e6);
    expect(await s.usdt.balanceOf(pair)).to.equal(10n*e6);
    await s.usdt.connect(s.creator).transfer(v,5n*e6);
    await token.connect(s.creator).transfer(v,e18);
    expect(await v.collateralValue()).to.equal(100n*e18);expect(await v.outstandingSupply()).to.equal(100n*e18);
    await expect(v.transferQuoteForMigration(s.creator.address,1)).to.be.revertedWithCustomError(v,"Unauthorized");
    await expect(v.transferTokenForMigration(s.creator.address,1)).to.be.revertedWithCustomError(v,"Unauthorized");
    await expect(v.transferQuote(s.creator.address,1)).to.be.revertedWithCustomError(v,"CoreTradeDisabled");
  });
  it("rolls back invalid launch, insufficient inventory and min-output failures",async function(){
    const s=await fixture({cap:110n*e18});
    await expect(s.factory.previewCreate(s.basket,99n*e6)).to.be.revertedWith("IndexFi: seed or count");
    await s.usdt.connect(s.creator).approve(s.factory,110n*e6);
    const m=Array.from(await s.factory.previewCreate(s.basket,100n*e6));
    await expect(s.factory.connect(s.creator).createVault(1,s.basket,100n*e6,10n*e6,0,[m[0]+1n,m[1]],await deadline(),"0x")).to.be.reverted;
    expect(await s.factory.vaultCount()).to.equal(0n);
    const {v}=await create(s);await s.usdt.connect(s.investor).approve(v,100n*e6);
    await expect(v.connect(s.investor).deposit(100n*e6,0,[0,0],await deadline())).to.be.revertedWithCustomError(v,"InsufficientInventory");
    expect(await v.outstandingSupply()).to.equal(100n*e18);
  });
  it("lets the creator withdraw LP without touching collateral and keeps residual LP shares backed",async function(){
    const s=await fixture();const {v,token,pair}=await create(s);const value=await v.collateralValue();
    await pair.connect(s.creator).transfer(pair,await pair.balanceOf(s.creator.address));await pair.burn(s.creator.address);
    expect(await v.collateralValue()).to.equal(value);expect(await v.outstandingSupply()).to.equal(100n*e18);
    expect(await token.balanceOf(pair)).to.be.gt(0n); // fixture's minimum locked LP
    const shares=await token.balanceOf(s.creator.address);await redeem(s,v,token,s.creator,shares);
    expect(await v.closed()).to.equal(false);expect(await v.outstandingSupply()).to.equal(await token.balanceOf(pair));
  });
  it("uses production adapter code against nonlinear V2 fixture, not frictionless swap assumptions",async function(){
    const s=await fixture({realSwaps:true});const {v}=await create(s);
    expect(await v.outstandingSupply()).to.be.lt(100n*e18);expect(await v.nav()).to.equal(e18);
    const shares=await deposit(s,v);expect(shares).to.be.lt(999n*e18/10n);expect(await v.nav()).to.be.gte(e18);
  });
  it("supports both primary/secondary arbitrage directions without changing backing on swaps",async function(){
    const s=await fixture();const {v,token,pair}=await create(s);const path=[await s.usdt.getAddress(),await token.getAddress()];
    const initial=await v.outstandingSupply();
    await s.usdt.connect(s.arb).approve(s.router,5n*e6);
    await s.router.connect(s.arb).swapExactTokensForTokens(5n*e6,0,path,s.arb.address,await deadline());
    expect(await v.outstandingSupply()).to.equal(initial);
    // Premium: primary issuance then sell on secondary market.
    const issued=await deposit(s,v,2n*e6);const cashBefore=await s.usdt.balanceOf(s.investor.address);
    await token.connect(s.investor).approve(s.router,issued);
    await s.router.connect(s.investor).swapExactTokensForTokens(issued,0,[...path].reverse(),s.investor.address,await deadline());
    expect(await s.usdt.balanceOf(s.investor.address)-cashBefore).to.be.gt(2n*e6);
    // Push price below NAV, then buy cheap shares and redeem.
    await token.connect(s.creator).approve(s.router,20n*e18);
    await s.router.connect(s.creator).swapExactTokensForTokens(20n*e18,0,[...path].reverse(),s.creator.address,await deadline());
    await s.usdt.connect(s.investor).approve(s.router,1n*e6);
    await s.router.connect(s.investor).swapExactTokensForTokens(1n*e6,0,path,s.investor.address,await deadline());
    const cheap=await token.balanceOf(s.investor.address);const net=await redeem(s,v,token,s.investor,cheap);
    expect(net).to.be.gt(1n*e6);expect(await token.balanceOf(pair)).to.be.gt(0n);
  });
  it("preserves supply and collateral invariants across transfers and both exit paths",async function(){
    const s=await fixture();const {v,token}=await create(s);await expectSolvent(s,v,token);
    for(const [index,actor] of [s.investor,s.arb,s.investor,s.arb].entries()) {
      const amount=BigInt(25+index*7)*e6;
      await s.usdt.connect(actor).approve(v,amount);
      const [issued,outputs]=await v.previewDeposit(amount);
      await v.connect(actor).deposit(amount,issued,Array.from(outputs),await deadline());
      const recipient=actor===s.investor?s.arb:s.investor;
      await token.connect(actor).transfer(recipient.address,issued/10n);
      const exit=issued/4n;
      await token.connect(actor).approve(v,exit);
      if(index%2===0) {
        const [, ,net]=await v.previewRedeem(actor.address,exit);
        await v.connect(actor).redeem(exit,net,[0,0],await deadline());
      } else {
        const [, ,net]=await v.previewRedeemInKind(actor.address,exit);
        await v.connect(actor).redeemInKind(exit,Array.from(net),await deadline());
      }
      await expectSolvent(s,v,token);
    }
  });
});

describe("Atlas single-feed normalization and validation",function(){
  it("normalizes 8 decimals, rejects stale/zero and retains USDT parity",async function(){
    const cash=await ethers.deployContract("MockAsset",["USDT","USDT",6]);const asset=await ethers.deployContract("MockAsset",["Asset","A",18]);
    const feed=await ethers.deployContract("MockAtlasFeed",[8]);const now=(await ethers.provider.getBlock("latest")).timestamp;
    await feed.set(2000n*10n**8n,now,now,1);
    const oracle=await ethers.deployContract("AtlasPushOracle",[cash,[{asset:await asset.getAddress(),aggregator:await feed.getAddress(),maxAge:60}]]);
    expect(await oracle.price18(asset)).to.equal(2000n*e18);expect(await oracle.price18(cash)).to.equal(e18);
    await feed.set(1,now-100,now-100,1);await expect(oracle.price18(asset)).to.be.revertedWithCustomError(oracle,"StalePrice");
    await feed.set(0,now,now,1);await expect(oracle.price18(asset)).to.be.revertedWithCustomError(oracle,"InvalidPrice");
  });
});
