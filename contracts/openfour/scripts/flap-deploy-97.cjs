// Deploy the IndexFi Flap stack on BSC testnet (chain 97), per docs/flap/FLAP_MVP_IMPLEMENTATION_PLAN.md Phase B.
//
//   node scripts/compile-flap-selected.cjs                                   # artifacts into flap-artifacts/
//   node scripts/flap-deploy-97.cjs                                          # plan against chain 97 (no transactions)
//   FLAP_RPC=http://127.0.0.1:8547 FLAP_APPLY=1 node scripts/flap-deploy-97.cjs              # rehearsal on a local fork node
//   FLAP_APPLY=1 CONFIRM_CHAIN97=1 node scripts/flap-deploy-97.cjs           # real chain 97 (operator key from ../../.env)
//
// Reuses the 66 chain-97 test tokens of the OpenFour deployment (frontend manifest public/deployments/97.json). Creates
// asset/Flap-USD PancakeSwap pools at live Atlas prices (Flap USD has a public mint), then a new AtlasSignedOracle and
// PancakeV2BasketAdapter bound to Flap USD, the IndexFiFlapVault implementation and IndexFiFlapFactory, and enables the
// factory through the public whitelist helper. Idempotent: every finished step is recorded and reused. Keys never printed.
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');
const {decodeAtlasPayload} = require('../test/atlas-payload');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '../..');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const APPLY = process.env.FLAP_APPLY === '1';
const POOL_USD = BigInt(process.env.FLAP_POOL_USD || '100000');
const RECORD = path.join(ROOT, 'deployments', LOCAL ? 'flap-97.fork.json' : 'flap-97.json');
const OFFICIAL = {
  portal: '0x000042108465206185A077Edc3F3fd2b49060000', dock: '0x000048E888aBf09f690a952E1b386b2D031a0000',
  guardian: '0x00004d58290854c5E9880F4b5B1993c6Ad8b0000', helper: '0x77779969a11eff7582f3bCf48135A846A3457777',
  usd: '0x190C989D5665a0e404B444b53CAE9AbCfb600157', router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
  pcsFactory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17', tokenImplementation: '0x7777c57ff7dc441c1715b2e36fa581c48b782222',
};
const ATLAS = {pullApi: 'https://api.atlasoracle.io/report/v1/price/latest', signer: '0x59ed4701224fd9e2a85ef2946c2ab828c1ddc600', maxAge: 120};
const FACTORY = {cap: 1_000_000_000n * 10n ** 18n, buyTax: 0, sellTax: 100, taxDuration: 1, antiFarmerDuration: 0, dexId: 0, version: '3.0.0'};

const env = (file, name) => {
  if (!fs.existsSync(file)) return undefined;
  const line = fs.readFileSync(file, 'utf8').split('\n').find(l => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : undefined;
};
const artifact = name => {
  const hit = [];
  const walk = dir => { for (const f of fs.readdirSync(dir, {withFileTypes: true})) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name === `${name}.json`) hit.push(p); } };
  walk(path.join(ROOT, 'flap-artifacts'));
  if (!hit.length) throw Error(`${name} artifact missing: run node scripts/compile-flap-selected.cjs`);
  return JSON.parse(fs.readFileSync(hit[0], 'utf8'));
};
const ERC20 = ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)', 'function decimals() view returns (uint8)', 'function owner() view returns (address)'];
const PAIR = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)', 'function mint(address) returns (uint256)'];
const toJson = v => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));

async function atlasPrices(key, feeds) {
  const out = new Map();
  for (let i = 0; i < feeds.length; i += 20) {
    const res = await fetch(ATLAS.pullApi, {method: 'POST', headers: {'X-API-KEY': key, 'Content-Type': 'application/json'}, body: JSON.stringify({feedIds: feeds.slice(i, i + 20).map(String), signed: true})});
    const j = await res.json();
    if (res.status !== 200 || j.status?.error_code !== '0') throw Error(`Atlas Pull API failed (${res.status})`);
    if (ethers.recoverAddress(ethers.keccak256(j.data.payload), j.data.signature).toLowerCase() !== ATLAS.signer) throw Error('Atlas signer mismatch');
    for (const r of decodeAtlasPayload(j.data.payload)) out.set(r.feed, r.price);
  }
  return out;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  if (Number((await provider.getNetwork()).chainId) !== 97) throw Error('Not chain 97');
  if (APPLY && !LOCAL && process.env.CONFIRM_CHAIN97 !== '1') throw Error('Refusing chain-97 writes without CONFIRM_CHAIN97=1');
  const operatorAddress = env(path.join(REPO, '.env'), 'OPERATOR_ADDRESS');
  let signer;
  if (LOCAL) {
    // Fork rehearsal: act as the operator (owner of the 66 test tokens) without its key.
    // Calls at the fork block itself count as historical (no hardfork history for chain 97): mine past it first.
    await provider.send('evm_mine', []);
    await provider.send('hardhat_impersonateAccount', [operatorAddress]);
    await provider.send('hardhat_setBalance', [operatorAddress, '0x56BC75E2D63100000']);
    signer = new ethers.JsonRpcSigner(provider, operatorAddress);
  } else {
    const key = env(path.join(REPO, '.env'), 'OPERATOR_PRIVATE_KEY');
    if (APPLY && !key) throw Error('OPERATOR_PRIVATE_KEY missing in the root .env');
    signer = key ? new ethers.Wallet(key, provider) : null;
  }
  const from = signer ? await signer.getAddress() : operatorAddress;
  const rec = fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, 'utf8')) : {chainId: 97, provider: 'flap-direct-v3', official: OFFICIAL, contracts: {}, pools: {}};
  const save = () => { rec.updatedAt = new Date().toISOString(); fs.mkdirSync(path.dirname(RECORD), {recursive: true}); fs.writeFileSync(RECORD, JSON.stringify(toJson(rec), null, 2) + '\n'); };
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'frontend/apps/web/public/deployments/97.json'), 'utf8'));
  const assets = manifest.assets;
  console.log(`${APPLY ? 'APPLY' : 'PLAN'} ${LOCAL ? '(local fork)' : '(chain 97)'} | operator ${from} | ${assets.length} assets | pool depth ${POOL_USD} Flap USD`);
  if (!LOCAL) console.log('operator tBNB', ethers.formatEther(await provider.getBalance(from)));

  const usd = new ethers.Contract(OFFICIAL.usd, ERC20, signer ?? provider);
  const pcs = new ethers.Contract(OFFICIAL.pcsFactory, ['function getPair(address,address) view returns (address)', 'function createPair(address,address) returns (address)'], signer ?? provider);
  const atlasKey = env(path.join(REPO, 'backend/.env'), 'IND_ATLAS_API_KEY');
  if (!atlasKey) throw Error('Atlas key missing (backend/.env IND_ATLAS_API_KEY)');
  const prices = await atlasPrices(atlasKey, assets.map(a => a.feedId));

  // ---- 1. asset / Flap-USD pools at Atlas prices ----
  let created = 0;
  for (const a of assets) {
    const price = prices.get(a.feedId);
    if (!price) { console.log(`pool ${a.symbol}: SKIP no Atlas price`); continue; }
    let pair = await pcs.getPair(a.address, OFFICIAL.usd);
    if (pair !== ethers.ZeroAddress) {
      const [r0, r1] = await new ethers.Contract(pair, PAIR, provider).getReserves();
      if (r0 > 0n && r1 > 0n) {
        // Existing pool (e.g. seeded by another run): deepen it to the target at its current ratio, never re-price it.
        const usdIs0 = (await new ethers.Contract(pair, PAIR, provider).token0()).toLowerCase() === OFFICIAL.usd.toLowerCase();
        const [rUsd, rAsset] = usdIs0 ? [r0, r1] : [r1, r0], target = POOL_USD * 10n ** 18n;
        if (rUsd < target) {
          const addUsd = target - rUsd, addAsset = (addUsd * rAsset) / rUsd;
          if (!APPLY) { console.log(`pool ${a.symbol}: DEEPEN ${ethers.formatUnits(rUsd, 18)} -> ${POOL_USD} USD at the current ratio`); }
          else {
            await (await new ethers.Contract(a.address, ERC20, signer).mint(pair, addAsset)).wait();
            await (await usd.mint(pair, addUsd)).wait();
            const r = await (await new ethers.Contract(pair, PAIR, signer).mint(from)).wait();
            rec.pools[a.symbol] = {...(rec.pools[a.symbol] ?? {pair}), deepenedTo: POOL_USD, deepenTx: r.hash};
            save();
            console.log(`pool ${a.symbol}: deepened ${pair} to ${POOL_USD} USD`);
          }
        } else rec.pools[a.symbol] = rec.pools[a.symbol] ?? {pair};
        continue;
      }
    }
    const usdAmt = POOL_USD * 10n ** 18n, assetAmt = (POOL_USD * 10n ** BigInt(a.decimals) * 10n ** 18n) / price;
    if (!APPLY) { console.log(`pool ${a.symbol}: CREATE+SEED ${POOL_USD} USD + ${ethers.formatUnits(assetAmt, a.decimals)} ${a.symbol} @ ${ethers.formatUnits(price, 18)}`); continue; }
    if (pair === ethers.ZeroAddress) { await (await pcs.createPair(a.address, OFFICIAL.usd)).wait(); pair = await pcs.getPair(a.address, OFFICIAL.usd); }
    // Re-runs after an interrupted seed top up to the target instead of minting twice (no mispriced pools).
    const assetToken = new ethers.Contract(a.address, ERC20, signer);
    const haveAsset = await assetToken.balanceOf(pair), haveUsd = await usd.balanceOf(pair);
    if (haveAsset < assetAmt) await (await assetToken.mint(pair, assetAmt - haveAsset)).wait();
    if (haveUsd < usdAmt) await (await usd.mint(pair, usdAmt - haveUsd)).wait();
    const r = await (await new ethers.Contract(pair, PAIR, signer).mint(from)).wait();
    rec.pools[a.symbol] = {pair, usd: usdAmt, asset: assetAmt, priceUsd: ethers.formatUnits(price, 18), tx: r.hash};
    save(); created++;
    console.log(`pool ${a.symbol}: seeded ${pair}`);
  }
  console.log(`pools: ${Object.keys(rec.pools).length} ready${created ? `, ${created} created now` : ''}`);
  const ready = assets.filter(a => rec.pools[a.symbol] && prices.get(a.feedId));

  // ---- 2. contracts ----
  const deploy = async (name, args) => {
    if (rec.contracts[name] && (await provider.getCode(rec.contracts[name].address)).length > 2) { console.log(`${name}: reuse ${rec.contracts[name].address}`); return rec.contracts[name].address; }
    if (!APPLY) { console.log(`${name}: DEPLOY`); return null; }
    const art = artifact(name);
    const c = await new ethers.ContractFactory(art.abi, art.bytecode, signer).deploy(...args);
    const r = await c.deploymentTransaction().wait();
    rec.contracts[name] = {address: await c.getAddress(), tx: r.hash, block: r.blockNumber, deployedAt: new Date().toISOString()};
    save();
    console.log(`${name}: deployed ${rec.contracts[name].address}`);
    return rec.contracts[name].address;
  };
  if (APPLY && ready.length !== assets.length) throw Error(`Only ${ready.length}/${assets.length} pools ready; fix before deploying bindings`);
  const oracle = await deploy('AtlasSignedOracle', [ATLAS.signer, OFFICIAL.usd, ready.map(a => ({asset: a.address, feedId: a.feedId, maxAge: ATLAS.maxAge}))]);
  const adapter = await deploy('PancakeV2BasketAdapter', [OFFICIAL.usd, OFFICIAL.router, ready.map(a => ({asset: a.address, buyPath: [OFFICIAL.usd, a.address]}))]);
  const vaultImpl = await deploy('IndexFiFlapVault', []);
  const factory = adapter && oracle && vaultImpl ? await deploy('IndexFiFlapFactory', [{
    portal: OFFICIAL.portal, dock: OFFICIAL.dock, guardian: OFFICIAL.guardian, adapter, oracle, router: OFFICIAL.router, cap: FACTORY.cap,
    buyTax: FACTORY.buyTax, sellTax: FACTORY.sellTax, taxDuration: FACTORY.taxDuration, antiFarmerDuration: FACTORY.antiFarmerDuration, dexId: FACTORY.dexId, vaultImplementation: vaultImpl,
  }]) : null;
  if (!factory) { console.log('\nPlan only; set FLAP_APPLY=1 (and CONFIRM_CHAIN97=1 for chain 97) to execute.'); return; }

  // ---- 3. enable the factory through the public whitelist helper ----
  const portal = new ethers.Contract(OFFICIAL.portal, ['function launcherFactoryMultiplier(address) view returns (bool,uint16)'], provider);
  let [enabled, mult] = await portal.launcherFactoryMultiplier(factory);
  if (!enabled) {
    const helper = new ethers.Contract(OFFICIAL.helper, ['function whitelist(address,uint16)'], signer);
    await helper.whitelist.staticCall(factory, 0);
    const r = await (await helper.whitelist(factory, 0)).wait();
    rec.whitelist = {tx: r.hash, at: new Date().toISOString()};
    [enabled, mult] = await portal.launcherFactoryMultiplier(factory);
  }
  rec.portalMultiplier = {enabled, multiplierBps: Number(mult)};
  console.log(`Portal.launcherFactoryMultiplier(factory) = (${enabled}, ${mult})`);
  const f = new ethers.Contract(factory, artifact('IndexFiFlapFactory').abi, provider);
  rec.contracts.IndexFiFlapVaultFactory = {address: await f.vaultFactory()};

  // ---- 4. route probes (every admitted asset must quote both ways) ----
  const ad = new ethers.Contract(adapter, ['function quoteBuy(address,uint256) view returns (uint256)', 'function quoteSell(address,uint256) view returns (uint256)', 'function supportsAsset(address) view returns (bool)'], provider);
  const or = new ethers.Contract(oracle, ['function supportsAsset(address) view returns (bool)'], provider);
  rec.assets = [];
  const excluded = [];
  for (const a of ready) {
    try {
      const buy = await ad.quoteBuy(a.address, 10n ** 18n), sell = await ad.quoteSell(a.address, 10n ** BigInt(a.decimals) / 1000n || 1n);
      if (buy === 0n || sell === 0n || !(await ad.supportsAsset(a.address)) || !(await or.supportsAsset(a.address))) throw Error('zero quote or unsupported');
      rec.assets.push({address: a.address, symbol: a.symbol, decimals: a.decimals, referenceAssetId: a.referenceAssetId, feedId: a.feedId, isMock: true, pair: rec.pools[a.symbol].pair});
    } catch (e) { excluded.push({symbol: a.symbol, reason: e.shortMessage || e.message}); }
  }
  rec.excluded = excluded;
  save();
  console.log(`route probes: ${rec.assets.length} admitted, ${excluded.length} excluded${excluded.length ? ': ' + excluded.map(x => x.symbol).join(', ') : ''}`);
  console.log(`\nDone. Record: ${path.relative(REPO, RECORD)}`);
}
main().catch(e => { console.error(process.env.DEBUG ? e.stack : e.shortMessage || e.message); process.exitCode = 1; });
