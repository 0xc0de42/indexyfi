const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, takeSnapshot } = require("@nomicfoundation/hardhat-network-helpers");
const fx = require("./fixtures/atlas-basket.json");
const { priceIn, tsIn, maxTsIn } = require("./atlas-payload");

const ATLAS_SIGNER = ethers.getAddress(fx.signer);
const FEEDS = { mBTC: 751, mETH: 632, mSPY: 956 };
const MAX_AGE = 120;

const priceOf = priceIn;
async function advancePast(snapshot) {
  const target = maxTsIn(snapshot) + 5;
  if (await time.latest() < target) await time.increaseTo(target);
}
// Build an Atlas-format payload: per record feedId(4) | price(10) | timestamp(6), then a count byte.
function encode(records) {
  const parts = records.map(({ feed, price, ts }) =>
    ethers.concat([ethers.toBeHex(feed, 4), ethers.toBeHex(price, 10), ethers.toBeHex(ts, 6)]));
  return ethers.hexlify(ethers.concat([...parts, ethers.toBeHex(records.length, 1)]));
}
const rawSign = (wallet, payload) => wallet.signingKey.sign(ethers.keccak256(payload)).serialized; // no EIP-191 prefix, like Atlas

async function deploy(signer = ATLAS_SIGNER, maxAge = MAX_AGE) {
  const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 18]);
  const mBTC = await ethers.deployContract("MockAsset", ["Mock Bitcoin", "mBTC", 8]);
  const mETH = await ethers.deployContract("MockAsset", ["Mock Ether", "mETH", 18]);
  const mSPY = await ethers.deployContract("MockAsset", ["Mock S&P 500 ETF", "mSPY", 18]);
  const bindings = [
    { asset: await mBTC.getAddress(), feedId: FEEDS.mBTC, maxAge },
    { asset: await mETH.getAddress(), feedId: FEEDS.mETH, maxAge },
    { asset: await mSPY.getAddress(), feedId: FEEDS.mSPY, maxAge },
  ];
  const oracle = await ethers.deployContract("AtlasSignedOracle", [signer, usdt, bindings]);
  return { oracle, usdt, mBTC, mETH, mSPY };
}

describe("AtlasSignedOracle with real Atlas signed payloads", function () {
  let snap;
  beforeEach(async () => { snap = await takeSnapshot(); });
  afterEach(async () => { await snap.restore(); });

  it("verifies Atlas's documented example signature (feed 624 is not bound, so nothing is stored)", async function () {
    const { oracle } = await deploy();
    expect(await oracle.updatePrices.staticCall(fx.docExample.payload, fx.docExample.signature)).to.equal(0n);
  });

  it("accepts a live 3-asset basket payload and returns the exact Atlas prices", async function () {
    const { oracle, mBTC, mETH, mSPY, usdt } = await deploy(ATLAS_SIGNER, 10 * 365 * 24 * 60 * 60);
    await advancePast(fx.first);
    await expect(oracle.updatePrices(fx.first.payload, fx.first.signature))
      .to.emit(oracle, "PriceUpdated").withArgs(FEEDS.mBTC, await mBTC.getAddress(), priceOf(fx.first, FEEDS.mBTC), tsIn(fx.first, FEEDS.mBTC));
    expect(await oracle.price18(mBTC)).to.equal(priceOf(fx.first, FEEDS.mBTC));
    expect(await oracle.price18(mETH)).to.equal(priceOf(fx.first, FEEDS.mETH));
    expect(await oracle.price18(mSPY)).to.equal(priceOf(fx.first, FEEDS.mSPY));
    expect(await oracle.price18(usdt)).to.equal(10n ** 18n);
  });

  it("moves forward with a newer payload and never rolls back to an older one", async function () {
    const { oracle, mBTC } = await deploy(ATLAS_SIGNER, 10 * 365 * 24 * 60 * 60);
    await advancePast(fx.second);
    await oracle.updatePrices(fx.first.payload, fx.first.signature);
    await oracle.updatePrices(fx.second.payload, fx.second.signature);
    expect(await oracle.price18(mBTC)).to.equal(priceOf(fx.second, FEEDS.mBTC));
    expect(await oracle.updatePrices.staticCall(fx.first.payload, fx.first.signature)).to.equal(0n);
    await oracle.updatePrices(fx.first.payload, fx.first.signature);
    expect(await oracle.price18(mBTC)).to.equal(priceOf(fx.second, FEEDS.mBTC));
  });

  it("rejects a tampered payload and a signature from any other key", async function () {
    const { oracle } = await deploy();
    const bytes = ethers.getBytes(fx.first.payload);
    bytes[10] ^= 0x01; // nudge BTC's price
    await expect(oracle.updatePrices(ethers.hexlify(bytes), fx.first.signature)).to.be.revertedWithCustomError(oracle, "InvalidSigner");
    const impostor = ethers.Wallet.createRandom();
    await expect(oracle.updatePrices(fx.first.payload, rawSign(impostor, fx.first.payload)))
      .to.be.revertedWithCustomError(oracle, "InvalidSigner").withArgs(impostor.address);
  });

  it("refuses stale prices on read but keeps the settlement token at 1", async function () {
    const key = ethers.Wallet.createRandom();
    const { oracle, mSPY, usdt } = await deploy(key.address);
    const now = await time.latest();
    const payload = encode([{ feed: FEEDS.mSPY, price: 500n * 10n ** 18n, ts: now }]);
    await oracle.updatePrices(payload, rawSign(key, payload));
    expect((await oracle.priceInfo(mSPY)).fresh).to.equal(true);
    await time.increase(MAX_AGE + 1);
    await expect(oracle.price18(mSPY)).to.be.revertedWithCustomError(oracle, "StalePrice");
    expect((await oracle.priceInfo(mSPY)).fresh).to.equal(false);
    expect(await oracle.price18(usdt)).to.equal(10n ** 18n);
  });

  it("refuses an asset with no price yet and an unbound asset", async function () {
    const { oracle, mETH } = await deploy();
    await expect(oracle.price18(mETH)).to.be.revertedWithCustomError(oracle, "NoPrice");
    const other = await ethers.deployContract("MockAsset", ["Other", "OTH", 18]);
    expect(await oracle.supportsAsset(other)).to.equal(false);
    expect(await oracle.supportsAsset(mETH)).to.equal(true);
    await expect(oracle.price18(other)).to.be.revertedWithCustomError(oracle, "UnsupportedAsset");
  });

  it("checks payload shape, zero prices and future timestamps (test signer)", async function () {
    const key = ethers.Wallet.createRandom();
    const { oracle } = await deploy(key.address);
    const now = await time.latest();
    const send = (p) => oracle.updatePrices(p, rawSign(key, p));
    await expect(send(encode([{ feed: 751, price: 0n, ts: now }]))).to.be.revertedWithCustomError(oracle, "InvalidPrice");
    await expect(send(encode([{ feed: 751, price: 1n, ts: now + 120 }]))).to.be.revertedWithCustomError(oracle, "FutureTimestamp");
    await expect(send("0x00")).to.be.revertedWithCustomError(oracle, "InvalidPayload");
    const good = encode([{ feed: 751, price: 5n * 10n ** 18n, ts: now }]);
    await expect(send(ethers.dataSlice(good, 1))).to.be.revertedWithCustomError(oracle, "InvalidPayload");
    const tooMany = encode(Array.from({ length: 21 }, (_, i) => ({ feed: 1000 + i, price: 1n, ts: now })));
    await expect(send(tooMany)).to.be.revertedWithCustomError(oracle, "InvalidPayload");
    await expect(send(encode([{ feed: 751, price: 1n, ts: now + 30 }]))).to.emit(oracle, "PriceUpdated"); // within allowed drift
  });

  it("rejects bad bindings at deployment", async function () {
    const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 18]);
    const a = await ethers.deployContract("MockAsset", ["A", "A", 18]);
    const b = await ethers.deployContract("MockAsset", ["B", "B", 18]);
    const F = await ethers.getContractFactory("AtlasSignedOracle");
    const bad = [
      [{ asset: a, feedId: 1, maxAge: 60 }, { asset: b, feedId: 1, maxAge: 60 }], // duplicate feed
      [{ asset: a, feedId: 1, maxAge: 60 }, { asset: a, feedId: 2, maxAge: 60 }], // duplicate asset
      [{ asset: usdt, feedId: 1, maxAge: 60 }], // settlement token as asset
      [{ asset: a, feedId: 1, maxAge: 0 }], // zero max age
      [{ asset: a, feedId: 0, maxAge: 60 }], // zero feed id
    ];
    for (const bindings of bad) await expect(F.deploy(ATLAS_SIGNER, usdt, bindings)).to.be.revertedWithCustomError(F, "InvalidBinding");
  });
});
