// Flap MVP full-cycle runner (docs/flap/FLAP_MVP_IMPLEMENTATION_PLAN.md Phase E/F) against a flap-deploy-97.cjs deployment.
//
//   FLAP_RPC=http://127.0.0.1:8547 node scripts/flap-full-cycle.cjs          # local fork rehearsal (flap-97.fork.json)
//   CONFIRM_CHAIN97=1 node scripts/flap-full-cycle.cjs                       # real chain 97 (flap-97.json)
//
// Creator = investor 1, trader = investor 2 (INVESTOR_MNEMONIC in the root .env; impersonated on a fork). Steps: prepare
// (request id, mined …7777 salt, predicted token, launchAuthorization) → createVaultWithPrices with Atlas-signed prices →
// verify events and predicted token → deposit → buy → sell → cash redemption → in-kind redemption → forwardTaxRevenue →
// reconcile supply/inventory/Dock. Results are appended to the deployment record under "fullCycle". Keys never printed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {ethers} = require('ethers');

const ROOT = path.resolve(__dirname, '..'), REPO = path.resolve(ROOT, '../..');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const LOCAL = /127\.0\.0\.1|localhost/.test(RPC);
const RECORD = path.join(ROOT, 'deployments', LOCAL ? 'flap-97.fork.json' : 'flap-97.json');
const PULL = 'https://api.atlasoracle.io/report/v1/price/latest', ATLAS_SIGNER = '0x59ed4701224fd9e2a85ef2946c2ab828c1ddc600';
const E18 = 10n ** 18n, SEED = 1_000n * E18, LIQ = 100n * E18, SLIP_BPS = 100n;
// Parameters for prepared demo portfolios (docs/demo/RUNBOOK.md); defaults reproduce the original full cycle.
const CREATOR_INDEX = Number(process.env.FLAP_CREATOR_INDEX || 1), TRADER_INDEX = Number(process.env.FLAP_TRADER_INDEX || 2);
const RECORD_KEY = process.env.FLAP_RECORD_KEY || 'fullCycle';
const STEPS = process.env.FLAP_STEPS ? new Set(process.env.FLAP_STEPS.split(',')) : null;
const env = (file, name) => { const l = fs.readFileSync(file, 'utf8').split('\n').find(x => x.startsWith(`${name}=`)); return l ? l.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '') : undefined; };
const abi = name => { const a = require(`../flap-abi/${name}.abi.json`); return Array.isArray(a) ? a : a.abi; };
const floor = x => (x * (10_000n - SLIP_BPS)) / 10_000n;
const reason = e => (e.shortMessage || e.message || String(e)).split('\n')[0].slice(0, 180);

/** Flap launch preparation, same rule as frontend lib/flap.ts: CREATE2(Portal, salt, EIP-1167 clone of the token implementation). */
function prepareFlapLaunch({portal, implementation, suffix = '7777'}) {
  const initHash = ethers.keccak256('0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + implementation.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3');
  let n = BigInt('0x' + crypto.randomBytes(32).toString('hex'));
  for (let tries = 1; tries <= 5_000_000; tries++, n = (n + 1n) % 2n ** 256n) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(n), 32);
    const token = ethers.getCreate2Address(portal, salt, initHash);
    if (token.toLowerCase().endsWith(suffix)) {
      return {requestId: BigInt('0x' + crypto.randomBytes(31).toString('hex')) || 1n, salt, predictedToken: token, tries,
        launchAuthorization: ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [salt])};
    }
  }
  throw Error('no salt');
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  if (!LOCAL && process.env.CONFIRM_CHAIN97 !== '1') throw Error('Refusing chain-97 writes without CONFIRM_CHAIN97=1');
  const rec = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  const phrase = env(path.join(REPO, '.env'), 'INVESTOR_MNEMONIC');
  const derive = i => ethers.HDNodeWallet.fromPhrase(phrase, undefined, `m/44'/60'/0'/0/${i}`);
  let creator, trader;
  if (LOCAL) {
    await provider.send('evm_mine', []);
    const [a, b] = [derive(CREATOR_INDEX).address, derive(TRADER_INDEX).address];
    for (const x of [a, b]) { await provider.send('hardhat_impersonateAccount', [x]); await provider.send('hardhat_setBalance', [x, '0x8AC7230489E80000']); }
    creator = new ethers.JsonRpcSigner(provider, a); trader = new ethers.JsonRpcSigner(provider, b);
  } else { creator = derive(CREATOR_INDEX).connect(provider); trader = derive(TRADER_INDEX).connect(provider); }
  const C = rec.contracts, O = rec.official;
  const factory = new ethers.Contract(C.IndexFiFlapFactory.address, abi('IndexFiFlapFactory'), creator);
  const usd = new ethers.Contract(O.usd, ['function mint(address,uint256)', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'], creator);
  const run = rec[RECORD_KEY] = {startedAt: new Date().toISOString(), creator: await creator.getAddress(), trader: await trader.getAddress(), steps: {}};
  const save = () => fs.writeFileSync(RECORD, JSON.stringify(JSON.parse(JSON.stringify(rec, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), null, 2) + '\n');
  const step = async (name, fn) => {
    if (STEPS && !STEPS.has(name)) { console.log(`skip ${name}`); return run.steps[name] ?? null; }
    try { const out = await fn(); run.steps[name] = {ok: true, ...(out || {})}; console.log(`OK   ${name}`, out ? JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : ''); return out; }
    catch (e) { run.steps[name] = {ok: false, error: reason(e)}; console.log(`FAIL ${name}: ${reason(e)}`); throw e; }
    finally { save(); }
  };
  const key = env(path.join(REPO, 'backend/.env'), 'IND_ATLAS_API_KEY');
  async function signed(feeds) {
    const res = await fetch(PULL, {method: 'POST', headers: {'X-API-KEY': key, 'Content-Type': 'application/json'}, body: JSON.stringify({feedIds: feeds.map(String), signed: true})});
    const j = await res.json();
    if (res.status !== 200 || ethers.recoverAddress(ethers.keccak256(j.data.payload), j.data.signature).toLowerCase() !== ATLAS_SIGNER) throw Error('Atlas signed payload invalid');
    return [[j.data.payload], [j.data.signature]];
  }
  const deadline = async () => BigInt((await provider.getBlock('latest')).timestamp + 900);

  // Basket: FLAP_BASKET="ETH:3500,XRP:3500,SOL:3000" (symbol:bps), else the first two admitted assets 50/50.
  const spec = process.env.FLAP_BASKET ? process.env.FLAP_BASKET.split(',').map(x => x.split(':')) : null;
  const legs = spec ? spec.map(([sym]) => rec.assets.find(a => a.symbol === sym) ?? (() => { throw Error(`asset ${sym} not in the Flap deployment`); })()) : rec.assets.slice(0, 2);
  const weights = spec ? spec.map(([, w]) => Number(w)) : [5000, 5000];
  if (weights.reduce((x, y) => x + y, 0) !== 10_000) throw Error('FLAP_BASKET weights must total 10000');
  const basket = {name: process.env.FLAP_NAME || 'IndexFi Flap Demo', symbol: process.env.FLAP_SYMBOL || 'IFDEMO', metadataURI: process.env.FLAP_META || 'ipfs://indexfi-flap-demo', constituents: legs.map((a, i) => ({token: a.address, weightBps: weights[i]}))};
  const feeds = legs.map(a => a.feedId);

  await step('fund', async () => {
    for (const s of [creator, trader]) await (await usd.connect(s).mint(await s.getAddress(), 5_000n * E18)).wait();
    return {basket: legs.map(a => a.symbol)};
  });
  const prep = await step('prepare', async () => {
    const p = prepareFlapLaunch({portal: O.portal, implementation: O.tokenImplementation});
    if (await factory.usedRequestIds(p.requestId)) throw Error('request id used');
    return p;
  });
  const launched = await step('launch', async () => {
    await (await usd.approve(factory.target, SEED + LIQ)).wait();
    const [payloads, signatures] = await signed(feeds);
    const outs = await factory.quoteCreateWithPrices.staticCall(payloads, signatures, basket, SEED);
    const args = [payloads, signatures, prep.requestId, basket, SEED, LIQ, 0n, Array.from(outs).map(floor), await deadline(), prep.launchAuthorization];
    await factory.createVaultWithPrices.staticCall(...args);
    const r = await (await factory.createVaultWithPrices(...args, {gasLimit: 12_000_000})).wait();
    const ev = name => r.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === name);
    const created = ev('VaultCreated'), pl = ev('PortfolioLaunched');
    if (!created || !pl) throw Error('launch events missing');
    if (created.args.requestId !== prep.requestId || created.args.creator.toLowerCase() !== run.creator.toLowerCase()) throw Error('VaultCreated mismatch');
    if (pl.args.token.toLowerCase() !== prep.predictedToken.toLowerCase()) throw Error(`token ${pl.args.token} != predicted ${prep.predictedToken}`);
    if (!(await factory.isVault(pl.args.vault))) throw Error('not registered');
    return {tx: r.hash, gas: r.gasUsed, vault: pl.args.vault, token: pl.args.token, pair: pl.args.pair};
  });
  const vault = new ethers.Contract(launched.vault, abi('IndexFiFlapVault'), trader);
  const share = new ethers.Contract(launched.token, ['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)'], trader);
  const router = new ethers.Contract(O.router, ['function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', 'function getAmountsOut(uint256,address[]) view returns (uint256[])'], trader);

  await step('deposit', async () => {
    const amount = BigInt(process.env.FLAP_DEPOSIT || '100') * E18, [payloads, signatures] = await signed(feeds);
    await (await usd.connect(trader).approve(vault.target, amount)).wait();
    const [shares, outs] = await vault.quoteDepositWithPrices.staticCall(payloads, signatures, amount);
    const r = await (await vault.depositWithPrices(payloads, signatures, amount, floor(shares), Array.from(outs).map(floor), await deadline(), {gasLimit: 6_000_000})).wait();
    return {tx: r.hash, shares: ethers.formatUnits(await share.balanceOf(run.trader), 18)};
  });
  await step('buy', async () => {
    const amount = 5n * E18, b0 = await share.balanceOf(run.trader), quote = (await router.getAmountsOut(amount, [O.usd, launched.token]))[1];
    await (await usd.connect(trader).approve(router.target, amount)).wait();
    const r = await (await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amount, floor(quote) * 95n / 100n, [O.usd, launched.token], run.trader, await deadline(), {gasLimit: 1_500_000})).wait();
    return {tx: r.hash, received: ethers.formatUnits((await share.balanceOf(run.trader)) - b0, 18)};
  });
  await step('sell', async () => {
    const amount = 2n * E18, u0 = await usd.balanceOf(run.trader), quote = (await router.getAmountsOut(amount, [launched.token, O.usd]))[1];
    await (await share.approve(router.target, amount)).wait();
    const r = await (await router.swapExactTokensForTokensSupportingFeeOnTransferTokens(amount, floor(quote) * 95n / 100n, [launched.token, O.usd], run.trader, await deadline(), {gasLimit: 1_500_000})).wait();
    const got = (await usd.balanceOf(run.trader)) - u0;
    return {tx: r.hash, received: ethers.formatUnits(got, 18), untaxedQuote: ethers.formatUnits(quote, 18)};
  });
  await step('redeemCash', async () => {
    const shares = (await share.balanceOf(run.trader)) / 2n, [payloads, signatures] = await signed(feeds);
    await (await share.approve(vault.target, shares)).wait();
    const [, , net] = await vault.previewRedeem(run.trader, shares), [, expected] = await vault.previewRedeemAssets(run.trader, shares);
    const r = await (await vault.redeemWithPrices(payloads, signatures, shares, floor(net), Array.from(expected).map(floor), await deadline(), {gasLimit: 6_000_000})).wait();
    return {tx: r.hash, shares: ethers.formatUnits(shares, 18), netUSD: ethers.formatUnits(net, 18)};
  });
  await step('redeemInKind', async () => {
    const shares = await share.balanceOf(run.trader), [payloads, signatures] = await signed(feeds);
    await (await share.approve(vault.target, shares)).wait();
    const [, , net] = await vault.previewRedeemInKind(run.trader, shares);
    const r = await (await vault.redeemInKindWithPrices(payloads, signatures, shares, Array.from(net).map(floor), await deadline(), {gasLimit: 6_000_000})).wait();
    return {tx: r.hash, shares: ethers.formatUnits(shares, 18), legs: Array.from(net).map(x => ethers.formatUnits(x, 18))};
  });
  await step('forwardTaxRevenue', async () => {
    // Permissionless; transfers any unaccounted settlement surplus (tax revenue) to the creator, a no-op when there is none.
    const surplus = (await usd.balanceOf(vault.target)) - (await vault.collateralBalance(O.usd));
    const c0 = await usd.balanceOf(run.creator);
    const r = await (await vault.forwardTaxRevenue({gasLimit: 500_000})).wait();
    return {tx: r.hash, surplusBefore: ethers.formatUnits(surplus, 18), forwardedToCreator: ethers.formatUnits((await usd.balanceOf(run.creator)) - c0, 18)};
  });
  await step('reconcile', async () => {
    const [supply, outstanding, inventory] = [await share.totalSupply(), await vault.outstandingSupply(), await vault.inventory()];
    const dock = new ethers.Contract(O.dock, ['function balanceOf(address,address) view returns (uint256)'], provider);
    const inDock = await dock.balanceOf(launched.token, vault.target);
    if (outstanding + inventory !== supply) throw Error('outstanding + inventory != total supply');
    if (inDock !== inventory) throw Error('Dock credit != inventory');
    return {totalSupply: ethers.formatUnits(supply, 18), outstanding: ethers.formatUnits(outstanding, 18), inventory: ethers.formatUnits(inventory, 18), traderShares: ethers.formatUnits(await share.balanceOf(run.trader), 18)};
  });
  run.finishedAt = new Date().toISOString(); save();
  console.log(`\nFull cycle complete. Record: ${path.relative(REPO, RECORD)} (fullCycle)`);
}
main().catch(e => { console.error('runner stopped:', reason(e)); process.exitCode = 1; });
