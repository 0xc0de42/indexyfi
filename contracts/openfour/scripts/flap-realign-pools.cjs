// Realign the chain-97 asset/Flap-USD pools to live Atlas prices (operator). Large deposits push constituent pools away
// from Atlas, and the Flap vault rejects issuance when a pool is more than 5% off. Both sides are mintable test tokens
// (asset: operator mint; Flap USD: public mint), so the operator donates the missing amounts and calls pair.sync().
// No LP minted, nothing removed; reserves never shrink. Only pools more than FLAP_REALIGN_MIN_BPS (default 50) off.
//   node scripts/flap-realign-pools.cjs                          # plan
//   FLAP_APPLY=1 CONFIRM_CHAIN97=1 node scripts/flap-realign-pools.cjs
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');
const {decodeAtlasPayload} = require('../test/atlas-payload');

const ROOT = path.resolve(__dirname, '..'), REPO = path.resolve(ROOT, '../..');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const APPLY = process.env.FLAP_APPLY === '1', MIN_BPS = BigInt(process.env.FLAP_REALIGN_MIN_BPS || '50');
// Optional: deepen selected pools (FLAP_SYMBOLS=ETH,XRP) to at least FLAP_DEPTH_USD on the Flap-USD side.
const ONLY = process.env.FLAP_SYMBOLS ? new Set(process.env.FLAP_SYMBOLS.split(',')) : null;
const DEPTH = BigInt(process.env.FLAP_DEPTH_USD || '0') * 10n ** 18n;
const env = (file, name) => { const l = fs.readFileSync(file, 'utf8').split('\n').find(x => x.startsWith(`${name}=`)); return l ? l.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : undefined; };
const PAIR = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)', 'function sync()'];
const max = (...xs) => xs.reduce((a, b) => (b > a ? b : a));

async function main() {
  if (APPLY && process.env.CONFIRM_CHAIN97 !== '1') throw Error('Refusing chain-97 writes without CONFIRM_CHAIN97=1');
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/flap-97.json'), 'utf8'));
  const signer = APPLY ? new ethers.Wallet(env(path.join(REPO, '.env'), 'OPERATOR_PRIVATE_KEY'), provider) : null;
  const key = env(path.join(REPO, 'backend/.env'), 'IND_ATLAS_API_KEY');
  const usdAddr = rec.official.usd;
  const usd = new ethers.Contract(usdAddr, ['function mint(address,uint256)'], signer ?? provider);
  const prices = new Map();
  const feeds = rec.assets.map(a => a.feedId);
  for (let i = 0; i < feeds.length; i += 20) {
    const res = await fetch('https://api.atlasoracle.io/report/v1/price/latest', {method: 'POST', headers: {'X-API-KEY': key, 'Content-Type': 'application/json'}, body: JSON.stringify({feedIds: feeds.slice(i, i + 20).map(String), signed: true})});
    const j = await res.json();
    for (const r of decodeAtlasPayload(j.data.payload)) prices.set(r.feed, r.price);
  }
  let changed = 0;
  for (const a of rec.assets) {
    if (ONLY && !ONLY.has(a.symbol)) continue;
    const p = prices.get(a.feedId); if (!p) continue;
    const pc = new ethers.Contract(a.pair, PAIR, signer ?? provider);
    const [r0, r1] = await pc.getReserves();
    const usdIs0 = (await pc.token0()).toLowerCase() === usdAddr.toLowerCase();
    const c0 = usdIs0 ? r0 : r1, t0 = usdIs0 ? r1 : r0, scale = 10n ** BigInt(a.decimals);
    const poolPrice = (c0 * scale) / t0; // 18-decimal USD per whole token (Flap USD has 18 decimals)
    const gapBps = ((poolPrice > p ? poolPrice - p : p - poolPrice) * 10_000n) / p;
    if (gapBps < MIN_BPS && c0 >= DEPTH) continue;
    const C = max(DEPTH, c0, (t0 * p) / scale + 1n), T = max(t0, (C * scale) / p);
    console.log(`${a.symbol.padEnd(8)} pool ${ethers.formatUnits(poolPrice, 18)} vs Atlas ${ethers.formatUnits(p, 18)} (${Number(gapBps) / 100}% off)${APPLY ? '' : ' → would realign'}`);
    if (!APPLY) continue;
    if (C > c0) await (await usd.mint(a.pair, C - c0)).wait();
    if (T > t0) await (await new ethers.Contract(a.address, ['function mint(address,uint256)'], signer).mint(a.pair, T - t0)).wait();
    await (await pc.sync()).wait();
    changed++;
  }
  console.log(APPLY ? `realigned ${changed} pools` : 'plan only');
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
