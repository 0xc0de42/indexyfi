// Decode an Atlas signed payload exactly as AtlasSignedOracle does:
// N records of feedId(uint32) | price(uint80, 18 decimals) | timestamp(uint48 s), then a count byte.
// Use this, not `parsedPayload` JSON, whose large integers lose precision when parsed as JS numbers.
const { ethers } = require("ethers");

function decodeAtlasPayload(payload) {
  const b = ethers.getBytes(payload);
  const n = b[b.length - 1];
  if (b.length !== n * 20 + 1) throw new Error(`bad Atlas payload length ${b.length}`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = b.slice(i * 20, i * 20 + 20);
    out.push({ feed: Number(ethers.toBigInt(r.slice(0, 4))), price: ethers.toBigInt(r.slice(4, 14)), ts: Number(ethers.toBigInt(r.slice(14, 20))) });
  }
  return out;
}

const priceIn = (snap, feed) => decodeAtlasPayload(snap.payload).find((r) => r.feed === feed).price;
const tsIn = (snap, feed) => decodeAtlasPayload(snap.payload).find((r) => r.feed === feed).ts;
const maxTsIn = (snap) => Math.max(...decodeAtlasPayload(snap.payload).map((r) => r.ts));

module.exports = { decodeAtlasPayload, priceIn, tsIn, maxTsIn };
