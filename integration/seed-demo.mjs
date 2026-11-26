// Seed the five demo baskets (all 66 registry assets, each exactly once) on the LOCAL fixture chain through the real
// factory flow, then have investor 1 deposit (primary) and investor 2 buy on the pool (secondary).
//
//   node integration/seed-demo.mjs \
//     --manifest contracts/openfour/deployments/31337.json --rpc http://127.0.0.1:8545 \
//     --creator 0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE \
//     --investor 0xe716a4894a5558140c3E3FdE2772AE71A69aAB9e --investor 0x0cdf9fa9934aC2F8615d2ccD2b65A9968a275C1b \
//     --seed 500 --liquidity 50 --primary-investment 100 --secondary-investment 5 [--append] [--slippage-bps 100]
//
// Safeguards: chain 31337 and a fixture manifest only; accounts are impersonated on the Hardhat node (no private keys
// anywhere); only the configured creator launches; investor addresses are refused as creator; an empty factory is
// required unless --append; every basket must reach phase 3 with a funded pair, or the run fails.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ethers } = require("../contracts/openfour/node_modules/ethers");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EXPECTED_CREATOR = "0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE";
const MIGRATED = 3n;

const BASKETS = [
  { name: "Core Crypto", symbol: "CORE14", assets: "BTCB ETH SOL XRP ADA AVAX DOT LINK BCH LTC ZEC FIL NEAR DOGE" },
  { name: "DeFi & BNB", symbol: "DEFI13", assets: "AAVE ANKR ASTER AT CAKE SPA TAKE TWT UNI XVS PUFFER EGL1 M" },
  { name: "Dollar & Yield", symbol: "YIELD13", assets: "BUSD DAI FDUSD TUSD USD1 USDe USDT VAI XUSD wBETH slisBNB OIK CDL" },
  { name: "Tokenized Technology", symbol: "TECH13", assets: "AMDB ANTB CBRSB COINB GOOGLB INTCB LITEB METAB MSFTB MSTRB NBISB PLTRB QCOMB" },
  { name: "Markets & Emerging", symbol: "MKT13", assets: "AB B B2 CC DRAMB EWYB GLWB QQQB SHIB SOXLB SPYB SQQQB WDCB" },
].map((b) => ({ ...b, assets: b.assets.split(" ") }));

function parseArgs(argv) {
  const out = { investor: [], slippageBps: 100, append: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--append") { out.append = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`Missing value for ${k}`);
    if (k === "--investor") out.investor.push(v);
    else if (k === "--slippage-bps") out.slippageBps = Number(v);
    else out[k.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  for (const k of ["manifest", "rpc", "creator", "seed", "liquidity", "primaryInvestment", "secondaryInvestment"]) if (out[k] === undefined) throw new Error(`--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} is required`);
  if (out.investor.length !== 2) throw new Error("Pass exactly two --investor addresses");
  return out;
}

// Equal weights in bps; the last asset takes the rounding remainder (14 -> 13×714 + 718; 13 -> 12×769 + 772).
function equalWeights(n) {
  const each = Math.floor(10000 / n);
  const w = Array(n).fill(each);
  w[n - 1] = 10000 - each * (n - 1);
  if (w.reduce((a, b) => a + b, 0) !== 10000) throw new Error("weights do not total 10,000");
  return w;
}

const abi = (p, n) => JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/openfour/artifacts/contracts", p, `${n}.json`), "utf8")).abi;
const toJson = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const minus = (x, bps) => (x * BigInt(10000 - bps)) / 10000n;
// Explicit gas, mirroring frontend lib/vaults.ts gasLimit: node estimate +20%, else a size-based limit (~25% over
// measured usage), never above 16M. Hardhat's estimator fails for launches of 9+ assets although they use < 12M.
const GAS_CAP = 16_000_000n;
const FALLBACK = { create: [4_500_000n, 330_000n], deposit: [300_000n, 180_000n], swap: [600_000n, 0n] };
async function gasFor(kind, legs, estimate) {
  const e = await estimate().catch(() => undefined);
  const [base, perLeg] = FALLBACK[kind];
  const limit = e && e > 0n ? (e * 12n) / 10n : base + perLeg * BigInt(legs);
  return limit > GAS_CAP ? GAS_CAP : limit;
}
let stage = "setup";

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.resolve(a.manifest), "utf8"));
  const provider = new ethers.JsonRpcProvider(a.rpc);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== 31337n || manifest.chainId !== 31337 || manifest.fixture !== true) throw new Error(`Refusing: local fixture chain 31337 only (rpc chain ${chainId}, manifest chain ${manifest.chainId}, fixture ${manifest.fixture})`);

  const creator = ethers.getAddress(a.creator);
  const investors = a.investor.map((x) => ethers.getAddress(x));
  if (creator !== EXPECTED_CREATOR) throw new Error(`Only ${EXPECTED_CREATOR} may create baskets`);
  if (investors.includes(creator)) throw new Error("An investor address was passed as creator");
  if (new Set(investors).size !== 2) throw new Error("Investor addresses must differ");

  const factory = new ethers.Contract(manifest.factory, abi("IndexFiFactory.sol", "IndexFiFactory"), provider);
  if ((await provider.getCode(manifest.factory)) === "0x") throw new Error(`No factory at ${manifest.factory}; redeploy the fixture and resync the manifest`);
  const existing = await factory.vaultCount();
  if (existing !== 0n && !a.append) throw new Error(`Factory already has ${existing} vault(s). Start from a fresh chain, or pass --append`);

  const ERC20 = abi("helpers/MockAsset.sol", "MockAsset");
  const usdt = new ethers.Contract(manifest.settlementToken, ERC20, provider);
  const dec = Number(await usdt.decimals());
  const u = (x) => ethers.parseUnits(String(x), dec);
  const seed = u(a.seed), liq = u(a.liquidity), primary = u(a.primaryInvestment), secondary = u(a.secondaryInvestment);

  // Local-only: impersonate (no keys), top up native gas and fixture USDT.
  const signerFor = async (addr) => { await provider.send("hardhat_impersonateAccount", [addr]); return new ethers.JsonRpcSigner(provider, addr); };
  const report = { createdAt: new Date().toISOString(), chainId: 31337, manifest: path.relative(ROOT, path.resolve(a.manifest)), factory: manifest.factory, settlementToken: manifest.settlementToken, creator, investors, amounts: { seed: a.seed, liquidity: a.liquidity, primaryInvestment: a.primaryInvestment, secondaryInvestment: a.secondaryInvestment, slippageBps: a.slippageBps }, funding: [], baskets: [] };
  const fund = async (addr, needUsdt) => {
    const minGas = ethers.parseEther("1");
    if ((await provider.getBalance(addr)) < minGas) await provider.send("hardhat_setBalance", [addr, ethers.toQuantity(ethers.parseEther("2"))]);
    const bal = await usdt.balanceOf(addr);
    const minter = await signerFor(addr);
    if (bal < needUsdt) { const r = await (await usdt.connect(minter).mint(addr, needUsdt - bal)).wait(); report.funding.push({ address: addr, mintedUSDT: ethers.formatUnits(needUsdt - bal, dec), txHash: r.hash }); }
    report.funding.push({ address: addr, nativeGas: ethers.formatEther(await provider.getBalance(addr)), usdt: ethers.formatUnits(await usdt.balanceOf(addr), dec) });
  };
  stage = "funding";
  await fund(creator, (seed + liq) * BigInt(BASKETS.length));
  for (const inv of investors) await fund(inv, u(1000) > (primary + secondary) * 5n ? u(1000) : (primary + secondary) * 5n);

  const bySymbol = new Map(manifest.assets.map((x) => [x.symbol, x]));
  const creatorSigner = await signerFor(creator);
  const [inv1, inv2] = await Promise.all(investors.map(signerFor));
  const VAULT = abi("modules/vault/IndexFiVault.sol", "IndexFiVault");
  const PAIR = abi("helpers/MockV2.sol", "MockV2Pair");
  const router = new ethers.Contract(manifest.router, abi("helpers/MockV2.sol", "MockV2Router"), provider);
  const deadline = async () => BigInt((await provider.getBlock("latest")).timestamp + 600);

  for (const b of BASKETS) {
    const weights = equalWeights(b.assets.length);
    const constituents = b.assets.map((s, i) => {
      const asset = bySymbol.get(s);
      if (!asset) throw new Error(`${b.symbol}: ${s} is not in the manifest`);
      return { token: asset.address, weightBps: weights[i] };
    });
    const basket = { name: b.name, symbol: b.symbol, metadataURI: "", constituents };
    const requestId = BigInt("0x" + crypto.randomBytes(32).toString("hex"));

    // Quote, per-leg minimums, approve seed + liquidity, launch.
    stage = `${b.symbol} previewCreate`;
    const quote = Array.from(await factory.previewCreate(basket, seed));
    const minimums = quote.map((q) => minus(q, a.slippageBps));
    const approve = await (await usdt.connect(creatorSigner).approve(manifest.factory, seed + liq)).wait();
    stage = `${b.symbol} createVault`;
    const createArgs = [requestId, basket, seed, liq, 0, minimums, await deadline(), "0x"];
    const createGas = await gasFor("create", constituents.length, () => factory.connect(creatorSigner).createVault.estimateGas(...createArgs));
    const tx = await factory.connect(creatorSigner).createVault(...createArgs, { gasLimit: createGas });
    const rcpt = await tx.wait();
    const ev = rcpt.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "VaultCreated");
    if (!ev) throw new Error(`${b.symbol}: no VaultCreated event`);
    const vaultAddr = ev.args.vault;
    if (ev.args.creator !== creator || ev.args.requestId !== requestId) throw new Error(`${b.symbol}: VaultCreated creator/requestId mismatch`);

    // Verify: registered, migrated (phase 3), funded pair, creator binding.
    const vault = new ethers.Contract(vaultAddr, VAULT, provider);
    const [isVault, phase, pairAddr, vaultCreator, tokenAddr] = await Promise.all([factory.isVault(vaultAddr), vault.phase(), vault.pair(), vault.creator(), vault.token()]);
    const [r0, r1] = pairAddr === ethers.ZeroAddress ? [0n, 0n] : await new ethers.Contract(pairAddr, PAIR, provider).getReserves();
    const checks = { vaultCreated: true, isVault, phaseMigrated: phase === MIGRATED, pairNonZero: pairAddr !== ethers.ZeroAddress, pairFunded: r0 > 0n && r1 > 0n, creatorBound: vaultCreator === creator, weightsTotal10000: weights.reduce((x, y) => x + y, 0) === 10000 };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    if (failed.length) throw new Error(`${b.symbol}: verification failed: ${failed.join(", ")} (phase ${phase})`);

    stage = `${b.symbol} primary deposit`;
    // Investor 1: primary deposit at NAV.
    await (await usdt.connect(inv1).approve(vaultAddr, primary)).wait();
    const [shares, outputs] = await vault.previewDeposit(primary);
    const token = new ethers.Contract(tokenAddr, ERC20, provider);
    const before1 = await token.balanceOf(inv1.address);
    const depArgs = [primary, minus(shares, a.slippageBps), Array.from(outputs).map((o) => minus(o, a.slippageBps)), await deadline()];
    const depGas = await gasFor("deposit", constituents.length, () => vault.connect(inv1).deposit.estimateGas(...depArgs));
    const dep = await (await vault.connect(inv1).deposit(...depArgs, { gasLimit: depGas })).wait();
    const got1 = (await token.balanceOf(inv1.address)) - before1;

    stage = `${b.symbol} secondary buy`;
    // Investor 2: secondary purchase on the pool.
    const pathUT = [manifest.settlementToken, tokenAddr];
    const outQ = (await router.getAmountsOut(secondary, pathUT))[1];
    await (await usdt.connect(inv2).approve(manifest.router, secondary)).wait();
    const before2 = await token.balanceOf(inv2.address);
    const buyArgs = [secondary, minus(outQ, a.slippageBps), pathUT, inv2.address, await deadline()];
    const buyGas = await gasFor("swap", 0, () => router.connect(inv2).swapExactTokensForTokens.estimateGas(...buyArgs));
    const buy = await (await router.connect(inv2).swapExactTokensForTokens(...buyArgs, { gasLimit: buyGas })).wait();
    const got2 = (await token.balanceOf(inv2.address)) - before2;
    if (got1 === 0n || got2 === 0n) throw new Error(`${b.symbol}: investor received no shares`);

    const entry = {
      name: b.name, symbol: b.symbol, requestId, assets: b.assets.map((s, i) => ({ symbol: s, token: constituents[i].token, weightBps: weights[i] })),
      vault: vaultAddr, token: tokenAddr, pair: pairAddr, reserves: [r0, r1], nav: ethers.formatUnits(await vault.nav(), 18),
      collateralValueUSDT: ethers.formatUnits(await vault.collateralValue(), 18), outstandingSupply: ethers.formatUnits(await vault.outstandingSupply(), 18),
      verification: checks,
      tx: { approve: approve.hash, createVault: rcpt.hash, primaryDeposit: dep.hash, secondaryBuy: buy.hash },
      gas: { createLimit: createGas, createUsed: rcpt.gasUsed, depositLimit: depGas, depositUsed: dep.gasUsed, buyUsed: buy.gasUsed },
      investor1: { address: inv1.address, depositedUSDT: a.primaryInvestment, sharesReceived: ethers.formatUnits(got1, 18) },
      investor2: { address: inv2.address, spentUSDT: a.secondaryInvestment, tokensReceived: ethers.formatUnits(got2, 18) },
    };
    report.baskets.push(entry);
    console.log(`${b.symbol.padEnd(8)} ${String(b.assets.length).padStart(2)} assets  vault ${vaultAddr}  phase 3  launch gas ${rcpt.gasUsed}/${createGas}  NAV ${Number(entry.nav).toFixed(4)}  inv1 +${Number(entry.investor1.sharesReceived).toFixed(3)} sh  inv2 +${Number(entry.investor2.tokensReceived).toFixed(3)} tok`);
  }

  const covered = report.baskets.flatMap((b) => b.assets.map((x) => x.symbol));
  report.coverage = { assets: covered.length, unique: new Set(covered).size, manifestAssets: manifest.assets.length };
  report.vaultCount = (await factory.vaultCount()).toString();
  for (const addr of [creator, ...investors]) await provider.send("hardhat_stopImpersonatingAccount", [addr]);
  const outDir = path.join(ROOT, "integration/out");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `demo-seed-${report.createdAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify(toJson(report), null, 2) + "\n");
  console.log(`\n${report.baskets.length} baskets, ${report.coverage.unique}/${report.coverage.manifestAssets} assets covered, factory vaultCount ${report.vaultCount}. Report: ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => { console.error(`failed at ${stage}: ${e.shortMessage || e.message}`); if (process.env.DEBUG) console.error(e); process.exitCode = 1; });
