// One-transaction price injection: createVaultWithPrices / depositWithPrices / redeemWithPrices / redeemInKindWithPrices
// post signed price payloads to the oracle, then run the existing entry point in the same transaction. With the local
// MockIndexFiOracle the payloads are ignored; the Atlas-signed path is covered in dump/preset-ready (AtlasSignedOracle).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixtureServices, deployFixtureCore } = require("../scripts/lib/indexfi-v5-fixture");

const E18 = 10n ** 18n, e6 = 10n ** 6n;
const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 600);
const NONE = [[], []];

async function setup() {
  const s = await deployFixtureServices(ethers);
  const core = await deployFixtureCore(ethers);
  const factory = await ethers.deployContract("IndexFiFactory", [core, 1, s.adapter, s.oracle, s.router, 1_000_000_000n * E18]);
  const basket = { name: "Priced", symbol: "PRC", metadataURI: "", constituents: [
    { token: await s.eth.getAddress(), weightBps: 6000 }, { token: await s.btc.getAddress(), weightBps: 4000 }] };
  return { s, factory, basket };
}

describe("IndexFi V5 one-transaction price injection (*WithPrices)", function () {
  it("launches, deposits, redeems and redeems in kind through the *WithPrices entry points", async function () {
    const { s, factory, basket } = await setup();
    const seed = 100n * e6, liq = 10n * e6;
    await s.usdt.connect(s.creator).approve(factory, seed + liq);
    const mins = Array.from(await factory.previewCreate(basket, seed)).map((q) => (q * 99n) / 100n);
    await expect(factory.connect(s.creator).createVaultWithPrices(...NONE, 77n, basket, seed, liq, 0, mins, await deadline(), "0x"))
      .to.emit(factory, "VaultCreated");
    const v = await ethers.getContractAt("IndexFiVault", await factory.vaultAt(0));
    const token = await ethers.getContractAt("OpenFourToken", await v.token());
    expect(await v.creator()).to.equal(s.creator.address);
    expect(await v.phase()).to.equal(3n);

    const amount = 50n * e6;
    await s.usdt.connect(s.investor).approve(v, amount);
    const [shares, outs] = await v.previewDeposit(amount);
    await v.connect(s.investor).depositWithPrices(...NONE, amount, (shares * 99n) / 100n, Array.from(outs).map((o) => (o * 99n) / 100n), await deadline());
    const held = await token.balanceOf(s.investor.address);
    expect(held).to.be.gte((shares * 99n) / 100n);

    const half = held / 2n;
    await token.connect(s.investor).approve(v, held);
    const [, , net] = await v.previewRedeem(s.investor.address, half);
    const [, legs] = await v.previewRedeemAssets(s.investor.address, half);
    const before = await s.usdt.balanceOf(s.investor.address);
    await v.connect(s.investor).redeemWithPrices(...NONE, half, (net * 99n) / 100n, Array.from(legs).map((o) => (o * 99n) / 100n), await deadline());
    expect((await s.usdt.balanceOf(s.investor.address)) - before).to.be.gte((net * 99n) / 100n);

    const rest = await token.balanceOf(s.investor.address);
    const [kind] = await v.previewRedeemInKind(s.investor.address, rest);
    await v.connect(s.investor).redeemInKindWithPrices(...NONE, rest, Array.from(kind).map((o) => (o * 99n) / 100n), await deadline());
    expect(await token.balanceOf(s.investor.address)).to.equal(0n);
  });

  it("rejects mismatched or too many price payloads", async function () {
    const { s, factory, basket } = await setup();
    const seed = 100n * e6, liq = 10n * e6;
    await s.usdt.connect(s.creator).approve(factory, seed + liq);
    const mins = Array.from(await factory.previewCreate(basket, seed)).map((q) => (q * 99n) / 100n);
    await expect(factory.connect(s.creator).createVaultWithPrices(["0x01"], [], 78n, basket, seed, liq, 0, mins, await deadline(), "0x"))
      .to.be.revertedWith("IndexFi: prices");
    await expect(factory.connect(s.creator).createVaultWithPrices(Array(5).fill("0x01"), Array(5).fill("0x01"), 79n, basket, seed, liq, 0, mins, await deadline(), "0x"))
      .to.be.revertedWith("IndexFi: prices");
    await factory.connect(s.creator).createVault(80n, basket, seed, liq, 0, mins, await deadline(), "0x");
    const v = await ethers.getContractAt("IndexFiVault", await factory.vaultAt(0));
    await s.usdt.connect(s.investor).approve(v, 10n * e6);
    await expect(v.connect(s.investor).depositWithPrices(["0x01"], [], 10n * e6, 0, [0, 0], await deadline()))
      .to.be.revertedWithCustomError(v, "InvalidAmount");
  });
});
