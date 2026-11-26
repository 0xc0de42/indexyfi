// Curated contract list for the project submission: every deployed IndexFi address on BSC testnet (chain 97) with a
// BscScan link, generated from the deployment records and checked on chain (each address must have code).
//   node scripts/submission-contracts.cjs        → docs/submission/CONTRACTS.md
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');

const ROOT = path.resolve(__dirname, '..'), REPO = path.resolve(ROOT, '../..');
const OUT = path.join(REPO, 'docs/submission/CONTRACTS.md');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const SCAN = 'https://testnet.bscscan.com';
const readJson = p => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const link = a => `[\`${a}\`](${SCAN}/address/${a})`;
const tx = h => (h ? `[tx](${SCAN}/tx/${h})` : '');

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  const missing = [];
  const checked = new Map();
  const has = async a => { if (!checked.has(a)) { const c = await provider.getCode(a); checked.set(a, c.length > 2); if (c.length <= 2) missing.push(a); } return checked.get(a); };
  const row = async (name, address, note = '', txh) => { await has(address); return `| ${name} | ${link(address)} | ${[note, tx(txh)].filter(Boolean).join(' · ')} |`; };
  const table = rows => ['| Contract | Address | Notes |', '|---|---|---|', ...rows];

  const fork = readJson(path.join(REPO, 'dump/preset-ready/deployments/97.openfour-fork.json'));
  const of = readJson(path.join(REPO, 'dump/preset-ready/deployments/97.json'));
  const flap = readJson(path.join(ROOT, 'deployments/flap-97.json'));
  const manifest = readJson(path.join(REPO, 'frontend/apps/web/public/deployments/97.json'));
  const L = [];
  L.push('# IndexFi — deployed contracts (BSC Testnet, chain 97)', '');
  L.push(`Generated ${new Date().toISOString()} by \`contracts/openfour/scripts/submission-contracts.cjs\` from the deployment records; every address below was checked on chain to have code. Explorer: ${SCAN}.`, '');
  L.push('IndexFi turns a basket of tokens into one collateral-backed portfolio token: deposit or redeem at NAV (signed Atlas prices), trade on PancakeSwap. Two launch venues share one vault design: an OpenFour preset and a Flap direct launch.', '');

  // ---- OpenFour ----
  if (fork && of) {
    const A = fork.addresses, C = of.contracts;
    L.push('## 1. OpenFour launch venue', '', '### 1.1 OpenFour core (IndexFi\'s fork deployment, via the official fork-deploy tool)', '');
    L.push(...table([
      await row('OpenFour Core', A.core, 'launch entry point; signer = IndexFi operator'),
      await row('OpenFour Registry', A.registry, 'modules and presets'),
      await row('FeeRouter', A.feeRouter), await row('Tools', A.tools), await row('Create deployer', A.createDeployer),
      await row('Standard token implementation', A.tokenImpl), await row('Tax token implementation', A.taxTokenImpl),
      await row('Forward vault implementation', A.forwardVaultImpl), await row('Tax vault registry', A.taxVaultRegistry), await row('Preset validator (OpenFour)', A.validator),
    ]), '');
    const presetId = of.registry?.presetId ?? readJson(path.join(REPO, 'dump/preset-ready/deploy/97.config.json'))?.presetId;
    L.push(`### 1.2 IndexFi preset on OpenFour${presetId ? ` (preset id ${presetId})` : ''}`, '');
    const names = [['IndexFiFactory', 'portfolio factory and directory'], ['IndexFiVault', 'vault module (collateral-backed portfolio vault)'], ['IndexFiCurveModule', 'curve module'],
      ['IndexFiTradeModule', 'trade module'], ['IndexFiMigrateModule', 'migrate module (PancakeSwap pool at launch)'], ['IndexFiPresetValidator', 'preset validator'],
      ['AtlasSignedOracle', 'verifies Atlas-signed price payloads on chain'], ['PancakeV2BasketAdapter', 'PancakeSwap V2 routes for the 66 assets'], ['cash', 'test USDT (18 decimals, operator mint)']];
    L.push(...table(await Promise.all(names.filter(([n]) => C[n]).map(([n, note]) => row(n === 'cash' ? 'Test USDT (settlement)' : n, C[n].address, note, C[n].txHash)))), '');
    L.push('### 1.3 Portfolios (OpenFour)', '');
    const rows = [];
    for (const [sym, b] of Object.entries(of.baskets || {})) {
      rows.push(await row(`${b.name} (${sym}) — vault`, b.vault, 'launch', b.launchTx));
      if (b.token) rows.push(await row(`${sym} — portfolio token`, b.token));
      if (b.pair) rows.push(await row(`${sym} — PancakeSwap pool`, b.pair));
    }
    // Portfolios launched from the UI: anything else in the factory directory that is not hidden.
    const factory = new ethers.Contract(C.IndexFiFactory.address, ['function vaultCount() view returns (uint256)', 'function vaultAt(uint256) view returns (address)'], provider);
    const known = new Set([...Object.values(of.baskets || {}).map(b => b.vault.toLowerCase()), ...(manifest?.hiddenVaults || []).map(a => a.toLowerCase())]);
    const n = Number(await factory.vaultCount());
    for (let i = 0; i < n; i++) {
      const v = await factory.vaultAt(i);
      if (known.has(v.toLowerCase())) continue;
      const vault = new ethers.Contract(v, ['function name() view returns (string)', 'function symbol() view returns (string)'], provider);
      rows.push(await row(`${await vault.name().catch(() => 'Portfolio')} (${await vault.symbol().catch(() => '?')}) — vault`, v, 'launched from the IndexFi UI'));
    }
    L.push(...table(rows), '');
  }

  // ---- Flap ----
  if (flap && !flap.contracts?.IndexFiFlapFactory) {
    L.push('## 2. Flap launch venue', '', '_Deployment in progress: the Flap contracts are listed here once `flap-deploy-97.cjs` completes._', '');
  }
  if (flap?.contracts?.IndexFiFlapFactory) {
    const C = flap.contracts, O = flap.official;
    L.push('## 2. Flap launch venue (direct launch, Flap Portal)', '', '### 2.1 IndexFi Flap contracts', '');
    L.push(...table([
      await row('IndexFiFlapFactory (Launcher Factory)', C.IndexFiFlapFactory.address, `enabled on the Portal: (${flap.portalMultiplier?.enabled}, ${flap.portalMultiplier?.multiplierBps})`, C.IndexFiFlapFactory.tx),
      ...(C.IndexFiFlapVaultFactory ? [await row('IndexFiFlapVaultFactory', C.IndexFiFlapVaultFactory.address, 'native vault factory (created by the factory)')] : []),
      await row('IndexFiFlapVault (implementation)', C.IndexFiFlapVault.address, 'immutable logic', C.IndexFiFlapVault.tx),
      await row('AtlasSignedOracle (Flap USD)', C.AtlasSignedOracle.address, 'Atlas-signed prices, bound to Flap USD', C.AtlasSignedOracle.tx),
      await row('PancakeV2BasketAdapter (Flap USD)', C.PancakeV2BasketAdapter.address, `${flap.assets?.length ?? 0} asset routes`, C.PancakeV2BasketAdapter.tx),
    ]), '');
    if (flap.whitelist?.tx) L.push(`Factory enabled through the Flap whitelist helper: ${tx(flap.whitelist.tx)}.`, '');
    L.push('### 2.2 Flap protocol contracts used (official, not deployed by IndexFi)', '');
    L.push(...table([
      await row('Flap Portal', O.portal), await row('Flap Token Dock', O.dock), await row('Flap whitelist helper', O.helper),
      await row('Flap USD (settlement)', O.usd), await row('Flap tax-token implementation', O.tokenImplementation),
    ]), '');
    const fc = flap.fullCycle;
    if (fc?.steps?.launch?.ok) {
      const s = fc.steps;
      L.push('### 2.3 Flap demo portfolio (full lifecycle on chain 97)', '');
      L.push(...table([
        await row('Demo portfolio vault', s.launch.vault, 'launch', s.launch.tx),
        await row('Demo portfolio token (…7777, Flap tax token)', s.launch.token, 'address predicted from the mined salt'),
        await row('Demo PancakeSwap pool', s.launch.pair, 'initial LP burned'),
      ]), '');
      L.push('Lifecycle transactions: ' + ['deposit', 'buy', 'sell', 'redeemCash', 'redeemInKind', 'forwardTaxRevenue'].filter(k => s[k]?.tx).map(k => `${k} ${tx(s[k].tx)}`).join(' · '), '');
    }
    const t3mc = flap.demoT3MC?.steps;
    if (t3mc?.launch?.ok) {
      L.push('### 2.4 Prepared Top 3 Market Cap backup', '');
      L.push(...table([
        await row('Top 3 Market Cap (T3MC) — vault', t3mc.launch.vault, 'ETH 35% · XRP 35% · SOL 30%', t3mc.launch.tx),
        await row('T3MC — portfolio token (…7777)', t3mc.launch.token, 'address predicted from the mined salt'),
        await row('T3MC — PancakeSwap pool', t3mc.launch.pair, 'initial LP burned'),
      ]), '');
      if (t3mc.deposit?.tx) L.push(`Prepared investor deposit: ${tx(t3mc.deposit.tx)}.`, '');
    }
    // Flap portfolios launched from the IndexFi UI: the rest of the Flap factory directory.
    const ff = new ethers.Contract(C.IndexFiFlapFactory.address, ['function vaultCount() view returns (uint256)', 'function vaultAt(uint256) view returns (address)'], provider);
    const demoVaults = new Set([fc?.steps?.launch?.vault, t3mc?.launch?.vault].filter(Boolean).map(v => v.toLowerCase()));
    const extra = [];
    for (let i = 0, n = Number(await ff.vaultCount()); i < n; i++) {
      const v = await ff.vaultAt(i);
      if (demoVaults.has(v.toLowerCase())) continue;
      const vc = new ethers.Contract(v, ['function name() view returns (string)', 'function symbol() view returns (string)', 'function token() view returns (address)'], provider);
      extra.push(await row(`${await vc.name().catch(() => 'Portfolio')} (${await vc.symbol().catch(() => '?')}) — vault`, v, 'launched from the IndexFi UI'));
      const t = await vc.token().catch(() => null);
      if (t) extra.push(await row(`${await vc.symbol().catch(() => '?')} — portfolio token (…7777)`, t));
    }
    if (extra.length) L.push('### 2.5 Flap portfolios launched from the UI', '', ...table(extra), '');
  }

  // ---- Shared assets ----
  if (manifest) {
    L.push('## 3. Test assets (66 tokens standing in for the Atlas-priced mainnet assets)', '');
    L.push('Owner-mint test tokens on chain 97. Each has a PancakeSwap pool against test USDT (OpenFour) and against Flap USD (Flap).', '');
    const rows = ['| Asset | Token | OpenFour pool | Flap pool |', '|---|---|---|---|'];
    for (const a of manifest.assets) {
      await has(a.address);
      const ofPool = of?.pools?.[a.symbol]?.pair, flPool = flap?.pools?.[a.symbol]?.pair;
      rows.push(`| ${a.symbol} | ${link(a.address)} | ${ofPool ? `[pool](${SCAN}/address/${ofPool})` : '—'} | ${flPool ? `[pool](${SCAN}/address/${flPool})` : '—'} |`);
    }
    L.push(...rows, '');
  }
  L.push('## 4. Accounts', '', `| Role | Address |`, '|---|---|', `| Operator / deployer / OpenFour signer | ${link('0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE')} |`, '');
  if (missing.length) L.push('> **Warning:** no code found at: ' + missing.join(', '), '');
  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, L.join('\n'));
  console.log(`wrote ${path.relative(REPO, OUT)}: ${checked.size} addresses checked, ${missing.length} without code${missing.length ? ': ' + missing.join(', ') : ''}`);
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
