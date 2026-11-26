// Generate the Flap provider artifacts from a flap-deploy-97.cjs record (one source, so TypeScript and Python cannot drift):
//   frontend/apps/web/public/deployments/97/flap.json   schema-v6 manifest read by lib/server/flap-manifest.ts
//   frontend/apps/web/public/deployments/97/index.json  provider catalogue (openfour + flap-direct-v3)
//   backend/packages/assets/src/ind_assets/flap_selected.py  typed immutable mapping (generated, do not edit)
//
//   node scripts/flap-export-manifest.cjs            # from deployments/flap-97.json (chain 97)
//   FLAP_RECORD=deployments/flap-97.fork.json node scripts/flap-export-manifest.cjs --out <dir>   # fork rehearsal
// Reads the deployment's own immutables over RPC, so the files match what is on chain. Fails on duplicates.
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');

const ROOT = path.resolve(__dirname, '..'), REPO = path.resolve(ROOT, '../..');
const recordPath = path.resolve(ROOT, process.env.FLAP_RECORD || 'deployments/flap-97.json');
const outArg = process.argv.indexOf('--out');
const WEB = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(REPO, 'frontend/apps/web/public/deployments/97');
const PY = outArg > 0 ? path.join(WEB, 'flap_selected.py') : path.join(REPO, 'backend/packages/assets/src/ind_assets/flap_selected.py');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';

async function main() {
  const rec = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  const C = rec.contracts, O = rec.official;
  const factory = new ethers.Contract(C.IndexFiFlapFactory.address, require('../flap-abi/IndexFiFlapFactory.abi.json'), provider);
  const read = async n => factory[n]();
  const [vaultFactory, vaultImplementation, cap, buyTax, sellTax, taxDuration, antiFarmer, minimumSeed, minimumLiquidity, settlement, adapter, oracle, router] = await Promise.all(
    ['vaultFactory', 'vaultImplementation', 'maxSupply', 'buyTaxRate', 'sellTaxRate', 'taxDuration', 'antiFarmerDuration', 'minimumSeed', 'minimumLiquidity', 'settlementToken', 'adapter', 'oracle', 'router'].map(read));
  if (settlement.toLowerCase() !== O.usd.toLowerCase() || adapter !== C.PancakeV2BasketAdapter.address || oracle !== C.AtlasSignedOracle.address) throw Error('factory bindings do not match the record');
  const usd = ethers.getAddress(O.usd);
  const assets = rec.assets.map(a => ({
    address: ethers.getAddress(a.address), symbol: a.symbol, decimals: a.decimals, referenceAssetId: a.referenceAssetId, feedId: a.feedId, isMock: true,
    buyPath: [usd, ethers.getAddress(a.address)], sellPath: [ethers.getAddress(a.address), usd],
  }));
  for (const k of ['address', 'referenceAssetId', 'feedId']) {
    const v = assets.map(a => String(a[k]).toLowerCase());
    if (new Set(v).size !== v.length) throw Error(`duplicate ${k}`);
  }
  const manifest = {
    schemaVersion: 6, provider: 'flap-direct-v3', fixture: false, testAssets: true, chainId: 97,
    deploymentBlock: C.IndexFiFlapFactory.block ?? 0,
    factory: C.IndexFiFlapFactory.address, vaultFactory, vaultImplementation,
    portal: ethers.getAddress(O.portal), dockRouter: ethers.getAddress(O.dock), guardian: ethers.getAddress(O.guardian),
    settlementToken: usd, settlementDecimals: 18, adapter, oracle, router, tokenImplementation: ethers.getAddress(O.tokenImplementation),
    cap: cap.toString(), buyTaxBps: Number(buyTax), sellTaxBps: Number(sellTax), taxDuration: Number(taxDuration), antiFarmerDuration: Number(antiFarmer),
    minimumSeed: minimumSeed.toString(), minimumLiquidity: minimumLiquidity.toString(),
    salt: {suffix: '7777', lockRequired: false},
    assets,
  };
  fs.mkdirSync(WEB, {recursive: true});
  fs.writeFileSync(path.join(WEB, 'flap.json'), JSON.stringify(manifest, null, 2) + '\n');
  // Catalogue: the OpenFour manifest stays at deployments/97.json (the app's current path); Flap is listed beside it.
  fs.writeFileSync(path.join(WEB, 'index.json'), JSON.stringify({chainId: 97, providers: [
    {provider: 'openfour', manifest: '/deployments/97.json'},
    {provider: 'flap-direct-v3', manifest: '/deployments/97/flap.json'},
  ]}, null, 2) + '\n');
  const py = [
    '"""Generated Flap chain-97 execution mapping (contracts/openfour/scripts/flap-export-manifest.cjs). Do not edit by hand."""',
    '',
    'from dataclasses import dataclass',
    '',
    'from ind_core.models import AssetId, FeedId',
    '',
    '',
    '@dataclass(frozen=True, slots=True)',
    'class FlapAsset:',
    '    reference_asset_id: AssetId',
    '    symbol: str',
    '    feed_id: FeedId',
    '    token: str',
    '    decimals: int',
    '    buy_path: tuple[str, ...]',
    '    sell_path: tuple[str, ...]',
    '',
    '',
    `FLAP_FACTORY = "${manifest.factory}"`,
    `FLAP_SETTLEMENT_TOKEN = "${usd}"`,
    '',
    'FLAP_SELECTED_ASSETS: tuple[FlapAsset, ...] = (',
    ...assets.flatMap(a => [
      '    FlapAsset(',
      `        reference_asset_id=AssetId("${a.referenceAssetId}"),`,
      `        symbol="${a.symbol}",`,
      `        feed_id=FeedId(${a.feedId}),`,
      `        token="${a.address}",`,
      `        decimals=${a.decimals},`,
      `        buy_path=(${a.buyPath.map(x => `"${x}"`).join(', ')}),`,
      `        sell_path=(${a.sellPath.map(x => `"${x}"`).join(', ')}),`,
      '    ),',
    ]),
    ')',
    '',
  ].join('\n');
  fs.writeFileSync(PY, py);
  console.log(`wrote ${path.relative(REPO, path.join(WEB, 'flap.json'))} (${assets.length} assets, factory ${manifest.factory}), index.json, ${path.relative(REPO, PY)}`);
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
