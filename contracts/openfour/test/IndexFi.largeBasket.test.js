// Large baskets launch, deposit and redeem well under the per-transaction gas cap (EIP-7825, 16,777,216 under the
// Osaka rules this Hardhat runs). Hardhat's gas *estimator* overshoots by ~8/3 and fails for launches of 9+ assets,
// so every write here sends an explicit gas limit, as the frontend (lib/vaults.ts gasLimit) and scripts do.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixtureServices, deployFixtureCore } = require("../scripts/lib/indexfi-v5-fixture");

const E18 = 10n ** 18n, e6 = 10n ** 6n;
const TX_CAP = 16_777_216n;
const GAS = { gasLimit: 16_000_000n };
const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 600);

async function launch(n) {
  const assets = Array.from({ length: n }, (_, i) => ({ symbol: `A${i}`, name: `Asset ${i}`, decimals: i % 3 === 0 ? 8 : 18, price18: BigInt(i + 1) * 7n * E18 }));
  const s = await deployFixtureServices(ethers, assets);
  const core = await deployFixtureCore(ethers);
  const factory = await ethers.deployContract("IndexFiFactory", [core, 1, s.adapter, s.oracle, s.router, 1_000_000_000n * E18]);
  const each = Math.floor(10000 / n), w = Array(n).fill(each); w[n - 1] = 10000 - each * (n - 1);
  const basket = { name: `Large ${n}`, symbol: `L${n}`, metadataURI: "",
    constituents: await Promise.all(s.tokens.map(async (t, i) => ({ token: await t.getAddress(), weightBps: w[i] }))) };
  const seed = 500n * e6, liq = 50n * e6;
  await s.usdt.connect(s.creator).approve(factory, seed + liq);
  const mins = Array.from(await factory.previewCreate(basket, seed)).map((q) => (q * 99n) / 100n);
  const r = await (await factory.connect(s.creator).createVault(BigInt(1000 + n), basket, seed, liq, 0, mins, await deadline(), "0x", GAS)).wait();
  const v = await ethers.getContractAt("IndexFiVault", await factory.vaultAt(0));
  const token = await ethers.getContractAt("OpenFourToken", await v.token());
  return { s, v, token, launchGas: r.gasUsed };
}

describe("IndexFi V5 large baskets (explicit gas limits)", function () {
  it("launches, deposits into and redeems a 14-asset basket under the per-transaction cap", async function () {
    const { s, v, token, launchGas } = await launch(14);
    expect(await v.phase()).to.equal(3n);
    expect(await v.pair()).to.not.equal(ethers.ZeroAddress);
    expect((await v.constituents()).length).to.equal(14);
    expect(launchGas).to.be.lessThan(TX_CAP);

    const amount = 100n * e6;
    await s.usdt.connect(s.investor).approve(v, amount);
    const [shares, outputs] = await v.previewDeposit(amount);
    const dep = await (await v.connect(s.investor).deposit(amount, (shares * 99n) / 100n, Array.from(outputs).map((o) => (o * 99n) / 100n), await deadline(), GAS)).wait();
    expect(await token.balanceOf(s.investor.address)).to.be.gte((shares * 99n) / 100n);
    expect(dep.gasUsed).to.be.lessThan(TX_CAP);

    const held = await token.balanceOf(s.investor.address);
    await token.connect(s.investor).approve(v, held);
    const [, , net] = await v.previewRedeem(s.investor.address, held);
    const [, legs] = await v.previewRedeemAssets(s.investor.address, held);
    const before = await s.usdt.balanceOf(s.investor.address);
    const red = await (await v.connect(s.investor).redeem(held, (net * 99n) / 100n, Array.from(legs).map((o) => (o * 99n) / 100n), await deadline(), GAS)).wait();
    expect((await s.usdt.balanceOf(s.investor.address)) - before).to.be.gte((net * 99n) / 100n);
    expect(red.gasUsed).to.be.lessThan(TX_CAP);
  });

  it("launches a 32-asset basket (the validator's maximum) under the per-transaction cap", async function () {
    const { v, launchGas } = await launch(32);
    expect(await v.phase()).to.equal(3n);
    expect((await v.constituents()).length).to.equal(32);
    expect(launchGas).to.be.lessThan(16_000_000n);
  });
});
