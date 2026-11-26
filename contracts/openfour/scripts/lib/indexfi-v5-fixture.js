// All mock contracts are restricted to chain 31337 in scripts. No testnet writes.
const E18 = 10n ** 18n;
const MAX_RESERVE = 2n ** 111n; // V2 reserves are uint112; keep headroom for swaps.

// Default two-asset fixture used by the contract tests (BTCB keeps 8 decimals on purpose).
const DEFAULT_ASSETS = [
  {symbol: "ETH", name: "Ether", decimals: 18, price18: 2000n * E18},
  {symbol: "BTCB", name: "Bitcoin", decimals: 8, price18: 80000n * E18},
];

/**
 * Mock USDT, oracle, V2 factory/router, and one USDT pool per asset with `depthUSDT`
 * on each side at the asset's oracle price. `assets`: [{symbol,name,decimals,price18}].
 */
async function deployFixtureServices(ethers, assets = DEFAULT_ASSETS, depthUSDT = 20_000_000n) {
  if ((await ethers.provider.getNetwork()).chainId !== 31337n) throw new Error("Fixture requires chain 31337");
  if (!assets.length) throw new Error("Fixture needs at least one asset");
  const [owner, creator, investor] = await ethers.getSigners();
  const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 6]);
  const oracle = await ethers.deployContract("MockIndexFiOracle", [usdt]);
  const dex = await ethers.deployContract("MockV2Factory");
  const router = await ethers.deployContract("MockV2Router", [dex]);
  const cash = await usdt.getAddress();
  const tokens = [];
  for (const a of assets) {
    if (a.price18 <= 0n) throw new Error(`Fixture price for ${a.symbol} must be positive`);
    const token = await ethers.deployContract("MockAsset", [a.name, a.symbol, a.decimals]);
    await oracle.setPrice(token, a.price18);
    const amount = depthUSDT * E18 * 10n ** BigInt(a.decimals) / a.price18;
    if (amount === 0n || amount > MAX_RESERVE) throw new Error(`Pool size for ${a.symbol} outside V2 reserve range`);
    await dex.createPair(usdt, token);
    const pair = await dex.getPair(usdt, token);
    await usdt.mint(pair, depthUSDT * 10n ** 6n);
    await token.mint(pair, amount);
    await (await ethers.getContractAt("MockV2Pair", pair)).mint(owner.address);
    tokens.push(token);
  }
  const routes = await Promise.all(tokens.map(async t => ({asset: await t.getAddress(), buyPath: [cash, await t.getAddress()]})));
  const adapter = await ethers.deployContract("PancakeV2BasketAdapter", [usdt, router, routes]);
  for (const account of [owner, creator, investor]) await usdt.mint(account.address, 10000n * 10n ** 6n);
  const bySymbol = Object.fromEntries(assets.map((a, i) => [a.symbol, tokens[i]]));
  return {usdt, eth: bySymbol.ETH, btc: bySymbol.BTCB, tokens, oracle, dex, router, adapter, owner, creator, investor};
}
async function deployFixtureCore(ethers) {
  const token=await ethers.deployContract("OpenFourToken");
  const vault=await ethers.deployContract("IndexFiVault");
  const migration=await ethers.deployContract("IndexFiMigrateModule");
  const tokenModule=await ethers.deployContract("StandardTokenModule");
  return ethers.deployContract("MockIndexFiCore",[token,vault,migration,tokenModule]);
}
module.exports={deployFixtureServices,deployFixtureCore,DEFAULT_ASSETS};
