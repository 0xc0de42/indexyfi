// Flap acceptance probe on a local chain-97 fork: real Portal, Dock, Guardian, whitelist helper and Flap USD; mock
// adapter/oracle and a mock constituent (not under test here). Reports what the real Portal accepts.
const {ethers, network} = require('hardhat');
const PORTAL = '0x000042108465206185A077Edc3F3fd2b49060000', DOCK = '0x000048E888aBf09f690a952E1b386b2D031a0000';
const GUARDIAN = '0x00004d58290854c5E9880F4b5B1993c6Ad8b0000', HELPER = '0x77779969a11eff7582f3bCf48135A846A3457777';
const USD = '0x190C989D5665a0e404B444b53CAE9AbCfb600157', PCS_ROUTER = '0xD99D1c33F9fC3444f8101754aBC46c52416550D1';
const TOKEN_IMPL = process.env.FLAP_TOKEN_IMPL || '0x7777c57ff7dc441c1715b2e36fa581c48b782222';
const E18 = 10n ** 18n;
const clone = impl => '0x3d602d80600a3d3981f3363d3d373d3d3d363d73' + impl.slice(2).toLowerCase() + '5af43d82803e903d91602b57fd5bf3';
function mineSalt(suffix, impl, start = BigInt(Date.now())) {
  const initHash = ethers.keccak256(clone(impl));
  for (let i = 0n; i < 2_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(start + i), 32);
    if (ethers.getCreate2Address(PORTAL, salt, initHash).toLowerCase().endsWith(suffix)) return {salt, tries: i + 1n};
  }
  throw Error('no salt');
}
const reason = e => (e.shortMessage || e.message || String(e)).split('\n')[0].slice(0, 160);

async function main() {
  console.log('fork of chain', (await ethers.provider.getNetwork()).chainId, 'at block', await ethers.provider.getBlockNumber());
  const [creator] = await ethers.getSigners();
  const usd = await ethers.getContractAt(['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], USD);
  await (await usd.mint(creator.address, 1_000_000n * E18)).wait();
  const asset = await ethers.deployContract('MockAsset', ['Ether', 'ETH', 18]);
  const oracle = await ethers.deployContract('MockIndexFiOracle', [USD]); await oracle.setPrice(asset, 2000n * E18);
  const adapter = await ethers.deployContract('MockIndexFiAdapter', [USD]); await adapter.setPrice(asset, 2000n * E18);
  await asset.mint(adapter, 10_000n * E18); await (await usd.mint(await adapter.getAddress(), 1_000_000n * E18)).wait();
  const impl = await ethers.deployContract('IndexFiFlapVault');
  const cfg = {vaultImplementation: await impl.getAddress(), portal: PORTAL, dock: DOCK, guardian: GUARDIAN, adapter: await adapter.getAddress(),
    oracle: await oracle.getAddress(), router: process.env.FLAP_ROUTER || PCS_ROUTER, cap: 1_000_000_000n * E18, buyTax: 0, sellTax: 100, taxDuration: 1, antiFarmerDuration: 0, dexId: 0};
  const factory = await ethers.deployContract('IndexFiFlapFactory', [cfg]);
  console.log('IndexFiFlapFactory deployed on fork:', await factory.getAddress());
  const portal = await ethers.getContractAt(['function launcherFactoryMultiplier(address) view returns (bool,uint16)'], PORTAL);
  console.log('multiplier before whitelist:', (await portal.launcherFactoryMultiplier(factory)).toString());
  const helper = await ethers.getContractAt(['function whitelist(address,uint16)'], HELPER);
  try { await (await helper.whitelist(await factory.getAddress(), 0)).wait(); console.log('helper.whitelist(factory, 0): OK'); }
  catch (e) { console.log('helper.whitelist FAILED:', reason(e)); }
  console.log('multiplier after whitelist:', (await portal.launcherFactoryMultiplier(factory)).toString());

  const basket = {name: 'IndexFi Flap Probe', symbol: 'IFXP', metadataURI: 'ipfs://indexfi-probe', constituents: [{token: await asset.getAddress(), weightBps: 5000}, {token: USD, weightBps: 5000}]};
  await (await usd.approve(await factory.getAddress(), ethers.MaxUint256)).wait();
  const seed = 1_000n * E18, liq = 100n * E18;
  const minimums = Array.from(await factory.previewCreate(basket, seed));
  const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp + 900);
  let request = 1n;
  async function attempt(label, salt) {
    const args = [request++, basket, seed, liq, 0n, minimums, deadline, ethers.AbiCoder.defaultAbiCoder().encode(['bytes32'], [salt])];
    try {
      await factory.createVault.staticCall(...args);
    } catch (e) { console.log(`${label}: REVERTS — ${reason(e)}`); return null; }
    const r = await (await factory.createVault(...args, {gasLimit: 16_000_000})).wait();
    const ev = r.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === 'PortfolioLaunched');
    console.log(`${label}: LAUNCHED — vault ${ev.args.vault} token ${ev.args.token} pair ${ev.args.pair} gas ${r.gasUsed}`);
    return ev.args;
  }
  const random = ethers.hexlify(ethers.randomBytes(32));
  let out = await attempt('random salt', random);
  if (!out) {
    const {salt, tries} = mineSalt('7777', TOKEN_IMPL);
    console.log(`mined …7777 salt for impl ${TOKEN_IMPL} in ${tries} tries`);
    out = await attempt('mined 7777 salt', salt);
  }
  if (out) {
    const v = await ethers.getContractAt('IndexFiFlapVault', out.vault);
    const tok = await ethers.getContractAt(['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function name() view returns (string)'], out.token);
    console.log('token', await tok.name(), 'supply', ethers.formatUnits(await tok.totalSupply(), 18), '| creator shares', ethers.formatUnits(await tok.balanceOf(creator.address), 18),
      '| vault phase', await v.phase(), 'inventory', ethers.formatUnits(await v.inventory(), 18), '| isVault', await factory.isVault(out.vault));
    console.log('token code', (await ethers.provider.getCode(out.token)).slice(0, 60));
    const [, investor] = await ethers.getSigners();
    await (await usd.mint(investor.address, 10_000n * E18)).wait();
    const share = await ethers.getContractAt(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'], out.token);
    const later = BigInt((await ethers.provider.getBlock('latest')).timestamp + 900);
    // Deposit 100 USD: shares come out of the vault's inventory in the REAL Token Dock.
    try {
      await (await usd.connect(investor).approve(out.vault, 100n * E18)).wait();
      const [shares, outs] = await v.previewDeposit(100n * E18);
      await (await v.connect(investor).deposit(100n * E18, shares, Array.from(outs), later, {gasLimit: 8_000_000})).wait();
      console.log('deposit 100 USD via real Dock: OK →', ethers.formatUnits(await share.balanceOf(investor.address), 18), 'shares | inventory', ethers.formatUnits(await v.inventory(), 18));
    } catch (e) { console.log('deposit FAILED:', reason(e)); }
    // Redeem half in kind (oracle-free) and the rest to USD.
    try {
      const held = await share.balanceOf(investor.address), half = held / 2n;
      await (await share.connect(investor).approve(out.vault, held)).wait();
      const [, , net] = await v.previewRedeemInKind(investor.address, half);
      await (await v.connect(investor).redeemInKind(half, Array.from(net), later, {gasLimit: 8_000_000})).wait();
      const [, , netUSD] = await v.previewRedeem(investor.address, held - half);
      const [legs] = await v.previewRedeemAssets(investor.address, held - half);
      await (await v.connect(investor).redeem(held - half, netUSD * 99n / 100n, Array.from(legs).map(() => 0n), later, {gasLimit: 8_000_000})).wait();
      console.log('redeem in kind + to USD via real Dock: OK | investor shares left', ethers.formatUnits(await share.balanceOf(investor.address), 18), '| inventory', ethers.formatUnits(await v.inventory(), 18));
    } catch (e) { console.log('redeem FAILED:', reason(e)); }
    // Secondary market: buy then sell on the PancakeSwap pair the Portal created (sell tax 1% configured).
    try {
      const router = await ethers.getContractAt(['function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)', 'function getAmountsOut(uint256,address[]) view returns (uint256[])'], PCS_ROUTER);
      await (await usd.connect(investor).approve(PCS_ROUTER, 5n * E18)).wait();
      const b0 = await share.balanceOf(investor.address);
      await (await router.connect(investor).swapExactTokensForTokensSupportingFeeOnTransferTokens(5n * E18, 0n, [USD, out.token], investor.address, later, {gasLimit: 2_000_000})).wait();
      const bought = (await share.balanceOf(investor.address)) - b0;
      const quoteBuy = (await router.getAmountsOut(5n * E18, [USD, out.token]))[1];
      await (await share.connect(investor).approve(PCS_ROUTER, bought)).wait();
      const u0 = await usd.balanceOf(investor.address); const expectSell = (await router.getAmountsOut(bought, [out.token, USD]))[1];
      await (await router.connect(investor).swapExactTokensForTokensSupportingFeeOnTransferTokens(bought, 0n, [out.token, USD], investor.address, later, {gasLimit: 2_000_000})).wait();
      const got = (await usd.balanceOf(investor.address)) - u0;
      console.log(`buy 5 USD → ${ethers.formatUnits(bought, 18)} shares | sell them → ${ethers.formatUnits(got, 18)} USD (untaxed quote ${ethers.formatUnits(expectSell, 18)}; effective sell haircut ${(100 - Number(got * 10000n / expectSell) / 100).toFixed(2)}%)`);
      const surplus = (await usd.balanceOf(out.vault)) - (await v.collateralBalance(USD));
      console.log('unaccounted settlement surplus (tax revenue forwardable to creator):', ethers.formatUnits(surplus, 18), 'USD');
    } catch (e) { console.log('secondary trade FAILED:', reason(e)); }
  }
}
main().catch(e => { console.error('probe failed:', reason(e)); process.exitCode = 1; });
