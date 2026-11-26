const {expect} = require("chai");
const {ethers} = require("hardhat");

const e6 = 10n ** 6n;
const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 600);

describe("IndexFi funded public vault", function () {
  async function suite() {
    const [owner, creator, depositor, follower] = await ethers.getSigners();
    const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 6]);
    const eth = await ethers.deployContract("MockAsset", ["Ether", "ETH", 18]);
    const btc = await ethers.deployContract("MockAsset", ["Bitcoin", "BTCB", 8]);
    const adapter = await ethers.deployContract("MockIndexFiAdapter", [usdt]);
    await adapter.setPrice(eth, 2_000n * e6);
    await adapter.setPrice(btc, 80_000n * e6);
    await eth.mint(adapter, 10_000n * 10n ** 18n);
    await btc.mint(adapter, 1_000n * 10n ** 8n);
    await usdt.mint(adapter, 10_000_000n * e6);
    for (const user of [creator, depositor, follower]) await usdt.mint(user, 1_000n * e6);

    const tokenImpl = await ethers.deployContract("IndexFiShare");
    const vaultImpl = await ethers.deployContract("IndexFiVault");
    const core = await ethers.deployContract("MockIndexFiCore", [tokenImpl, vaultImpl]);
    const factory = await ethers.deployContract("IndexFiFactory", [core, 7, adapter]);
    const basket = {
      name: "Blue Chip Basket", symbol: "BLUE", metadataURI: "ipfs://indexfi-blue",
      constituents: [{token: await eth.getAddress(), weightBps: 5000}, {token: await btc.getAddress(), weightBps: 5000}],
    };
    return {owner, creator, depositor, follower, usdt, eth, btc, adapter, factory, basket};
  }

  async function create(s, seed = 100n * e6) {
    await s.usdt.connect(s.creator).approve(s.factory, seed);
    const quoted = Array.from(await s.factory.previewCreate(s.basket, seed));
    await expect(s.factory.connect(s.creator).createVault(s.basket, seed, quoted, await deadline(), "0x"))
      .to.emit(s.factory, "VaultCreated");
    const address = await s.factory.vaultAt(0);
    return {vault: await ethers.getContractAt("IndexFiVault", address), quoted};
  }

  it("atomically opens at 100 USDT and rejects lower or malformed launches", async function () {
    const s = await suite();
    await expect(s.factory.previewCreate(s.basket, 99n * e6)).to.be.revertedWith("IndexFi: seed or count");
    const bad = {...s.basket, constituents: [s.basket.constituents[0], s.basket.constituents[0]]};
    await expect(s.factory.previewCreate(bad, 100n * e6)).to.be.revertedWith("IndexFi: duplicate");
    const {vault, quoted} = await create(s);
    expect(await s.factory.vaultCount()).to.equal(1);
    expect(await vault.creator()).to.equal(s.creator);
    expect(await vault.balanceOf(s.creator)).to.equal(100n * 10n ** 18n);
    expect(await vault.costBasisUSDT(s.creator)).to.equal(100n * e6);
    expect(await s.eth.balanceOf(vault)).to.equal(quoted[0]);
    expect(await s.btc.balanceOf(vault)).to.equal(quoted[1]);
    expect(await vault.metadataURI()).to.equal("ipfs://indexfi-blue");
  });

  it("mints at current value and pays 10% of a depositor's realized profit", async function () {
    const s = await suite();
    const {vault} = await create(s);
    const amount = 100n * e6;
    await s.usdt.connect(s.depositor).approve(vault, amount);
    const [shares, quoted] = await vault.previewDeposit(amount);
    const outputs = Array.from(quoted);
    expect(shares).to.equal(100n * 10n ** 18n);
    await expect(vault.connect(s.depositor).deposit(amount, shares, outputs, await deadline()))
      .to.emit(vault, "Deposited").withArgs(s.depositor, amount, shares);

    await s.adapter.setPrice(s.eth, 2_400n * e6);
    await s.adapter.setPrice(s.btc, 96_000n * e6);
    const [gross, fee, net] = await vault.previewRedeem(s.depositor, shares);
    expect([gross, fee, net]).to.deep.equal([120n * e6, 2n * e6, 118n * e6]);
    const creatorBefore = await s.usdt.balanceOf(s.creator);
    const holderBefore = await s.usdt.balanceOf(s.depositor);
    await expect(vault.connect(s.depositor).redeem(shares, net, await deadline()))
      .to.emit(vault, "Redeemed").withArgs(s.depositor, shares, amount, gross, fee, net);
    expect(await s.usdt.balanceOf(s.creator) - creatorBefore).to.equal(fee);
    expect(await s.usdt.balanceOf(s.depositor) - holderBefore).to.equal(net);
    expect(await vault.costBasisUSDT(s.depositor)).to.equal(0);
  });

  it("allows the creator to fully exit while another holder keeps the vault open", async function () {
    const s = await suite();
    const {vault} = await create(s);
    const amount = 100n * e6;
    await s.usdt.connect(s.follower).approve(vault, amount);
    const [shares, quoted] = await vault.previewDeposit(amount);
    const outputs = Array.from(quoted);
    await vault.connect(s.follower).deposit(amount, shares, outputs, await deadline());
    const creatorShares = await vault.balanceOf(s.creator);
    const [, , creatorNet] = await vault.previewRedeem(s.creator, creatorShares);
    await vault.connect(s.creator).redeem(creatorShares, creatorNet, await deadline());
    expect(await vault.balanceOf(s.creator)).to.equal(0);
    expect(await vault.closed()).to.equal(false);
    const [, , followerNet] = await vault.previewRedeem(s.follower, shares);
    await expect(vault.connect(s.follower).redeem(shares, followerNet, await deadline())).to.emit(vault, "VaultClosed");
    expect(await vault.closed()).to.equal(true);
  });

  it("rolls back when output protections fail", async function () {
    const s = await suite();
    const {vault} = await create(s);
    const amount = 100n * e6;
    await s.usdt.connect(s.depositor).approve(vault, amount);
    const [shares, outputs] = await vault.previewDeposit(amount);
    const impossible = Array.from(outputs, x => x + 1n);
    await expect(vault.connect(s.depositor).deposit(amount, shares, impossible, await deadline()))
      .to.be.revertedWith("IndexFi: buy slippage");
    expect(await vault.balanceOf(s.depositor)).to.equal(0);
    expect(await s.usdt.balanceOf(s.depositor)).to.equal(1_000n * e6);
  });
});
