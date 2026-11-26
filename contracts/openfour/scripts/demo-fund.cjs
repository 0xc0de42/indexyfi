// Top up the three pitch wallets to demo targets (docs/demo/RUNBOOK.md). Idempotent: only the shortfall is minted/sent.
//   node scripts/demo-fund.cjs                               # plan
//   DEMO_APPLY=1 CONFIRM_CHAIN97=1 node scripts/demo-fund.cjs
// OpenFour test USDT: operator (owner) mint. Flap USD: public mint. tBNB: transfer from the operator.
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');

const REPO = path.resolve(__dirname, '../../..');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const APPLY = process.env.DEMO_APPLY === '1';
const env = n => { const l = fs.readFileSync(path.join(REPO, '.env'), 'utf8').split('\n').find(x => x.startsWith(`${n}=`)); return l?.slice(n.length + 1).trim().replace(/^['"]|['"]$/g, ''); };
const OF_USDT = '0x48FB3d62B16de656534A74fEa4BbBaEBC900EA2d', FLAP_USD = '0x190C989D5665a0e404B444b53CAE9AbCfb600157';
const E18 = 10n ** 18n;
const TARGETS = {
  A: {address: '0xB64c94312De7Ff21FBb7f323Bfc3d9f1A6A3f1cE', usdt: 15_000n, flapUsd: 2_000n, tbnb: null},
  B: {address: '0xe716a4894a5558140c3E3FdE2772AE71A69aAB9e', usdt: 25_000n, flapUsd: 5_000n, tbnb: '0.5'},
  C: {address: '0x0cdf9fa9934aC2F8615d2ccD2b65A9968a275C1b', usdt: 2_000n, flapUsd: 5_000n, tbnb: '0.5'},
};

async function main() {
  if (APPLY && process.env.CONFIRM_CHAIN97 !== '1') throw Error('Refusing chain-97 writes without CONFIRM_CHAIN97=1');
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  const op = new ethers.Wallet(env('OPERATOR_PRIVATE_KEY'), provider);
  if (op.address !== TARGETS.A.address) throw Error('operator key does not match wallet A');
  const tokens = {usdt: new ethers.Contract(OF_USDT, ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)'], op),
    flapUsd: new ethers.Contract(FLAP_USD, ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)'], op)};
  console.log(APPLY ? 'APPLY' : 'PLAN');
  for (const [name, t] of Object.entries(TARGETS)) {
    for (const k of ['usdt', 'flapUsd']) {
      const have = await tokens[k].balanceOf(t.address), want = t[k] * E18;
      if (have >= want) { console.log(`${name} ${k}: ${ethers.formatUnits(have, 18)} (ok)`); continue; }
      console.log(`${name} ${k}: ${ethers.formatUnits(have, 18)} → mint ${ethers.formatUnits(want - have, 18)}`);
      if (APPLY) await (await tokens[k].mint(t.address, want - have)).wait();
    }
    if (t.tbnb) {
      const have = await provider.getBalance(t.address), want = ethers.parseEther(t.tbnb);
      if (have >= want) { console.log(`${name} tBNB: ${ethers.formatEther(have)} (ok)`); continue; }
      console.log(`${name} tBNB: ${ethers.formatEther(have)} → send ${ethers.formatEther(want - have)}`);
      if (APPLY) await (await op.sendTransaction({to: t.address, value: want - have})).wait();
    }
  }
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exitCode = 1; });
