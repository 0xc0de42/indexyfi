// Read-only: quote deposits into an existing Flap demo vault with fresh Atlas-signed prices.
// Defaults to the recorded T3MC backup and 200 Flap USD; no wallet or transaction is used.
//   node scripts/check-flap-deposit.cjs
//   FLAP_VAULT=0x... FLAP_DEPOSIT_SIZES=200,9300 node scripts/check-flap-deposit.cjs
const fs = require('node:fs');
const path = require('node:path');
const {ethers} = require('ethers');

const ROOT = path.resolve(__dirname, '..'), REPO = path.resolve(ROOT, '../..');
const RPC = process.env.FLAP_RPC || 'https://bsc-testnet-rpc.publicnode.com';
const PULL = 'https://api.atlasoracle.io/report/v1/price/latest';
const ATLAS_SIGNER = '0x59ed4701224fd9e2a85ef2946c2ab828c1ddc600';
const env = (file, name) => {
  const line = fs.readFileSync(file, 'utf8').split('\n').find(x => x.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
};

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, 97, {staticNetwork: true});
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/flap-97.json'), 'utf8'));
  const recorded = rec.demoT3MC?.steps?.launch?.vault;
  const address = process.env.FLAP_VAULT || recorded;
  if (!address || !ethers.isAddress(address)) throw Error('Set FLAP_VAULT or record demoT3MC first');
  const vault = new ethers.Contract(address, require('../flap-abi/IndexFiFlapVault.abi.json'), provider);
  const constituents = await vault.constituents();
  const byToken = new Map(rec.assets.map(a => [a.address.toLowerCase(), a]));
  const assets = constituents.map(c => byToken.get(c.token.toLowerCase()));
  if (assets.some(a => !a)) throw Error('Vault contains an asset absent from the Flap deployment record');
  const key = env(path.join(REPO, 'backend/.env'), 'IND_ATLAS_API_KEY');
  if (!key) throw Error('IND_ATLAS_API_KEY is missing');
  const response = await fetch(PULL, {
    method: 'POST',
    headers: {'X-API-KEY': key, 'Content-Type': 'application/json'},
    body: JSON.stringify({feedIds: assets.map(a => String(a.feedId)), signed: true}),
  });
  const body = await response.json();
  if (response.status !== 200 || !body.data?.payload || !body.data?.signature) throw Error(`Atlas Pull API ${response.status}`);
  const recovered = ethers.recoverAddress(ethers.keccak256(body.data.payload), body.data.signature);
  if (recovered.toLowerCase() !== ATLAS_SIGNER) throw Error('Atlas signer mismatch');
  const sizes = (process.env.FLAP_DEPOSIT_SIZES || '200').split(',').map(Number);
  for (const size of sizes) {
    if (!Number.isFinite(size) || size <= 0) throw Error('FLAP_DEPOSIT_SIZES must contain positive numbers');
    const input = ethers.parseUnits(String(size), 18);
    const [shares, outputs] = await vault.quoteDepositWithPrices.staticCall(
      [body.data.payload], [body.data.signature], input,
    );
    if (shares === 0n || outputs.some(x => x === 0n)) throw Error(`${size} Flap USD produced a zero quote`);
    const shareNumber = Number(ethers.formatUnits(shares, 18));
    console.log(`${address} | ${size} Flap USD -> ${shareNumber.toFixed(2)} shares (${(shareNumber / size * 100).toFixed(1)}%) | ${outputs.length} legs`);
  }
}

main().catch(error => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
