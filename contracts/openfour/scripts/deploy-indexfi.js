const fs = require("fs");
const path = require("path");

const REFERENCES = {
  ETH: {referenceAssetId: "56:0x2170ed0880ac9a755fd29b2688956bd959f933f8", feedId: 632},
  BTCB: {referenceAssetId: "56:0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", feedId: 751},
};

async function main() {
  const hre = require("hardhat");
  const [deployer, creator, depositor] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== 31337n) throw new Error("Local fixture deployment only supports chain 31337");

  const usdt = await hre.ethers.deployContract("MockAsset", ["Test USDT", "USDT", 6]);
  const eth = await hre.ethers.deployContract("MockAsset", ["Ether", "ETH", 18]);
  const btc = await hre.ethers.deployContract("MockAsset", ["Bitcoin", "BTCB", 8]);
  const adapter = await hre.ethers.deployContract("MockIndexFiAdapter", [usdt]);
  await adapter.setPrice(eth, 2_000n * 10n ** 6n);
  await adapter.setPrice(btc, 80_000n * 10n ** 6n);
  await eth.mint(adapter, 10_000n * 10n ** 18n);
  await btc.mint(adapter, 1_000n * 10n ** 8n);
  await usdt.mint(adapter, 10_000_000n * 10n ** 6n);
  for (const account of [deployer, creator, depositor]) await usdt.mint(account, 10_000n * 10n ** 6n);

  const tokenImplementation = await hre.ethers.deployContract("IndexFiShare");
  const vaultImplementation = await hre.ethers.deployContract("IndexFiVault");
  const core = await hre.ethers.deployContract("MockIndexFiCore", [tokenImplementation, vaultImplementation]);
  const factory = await hre.ethers.deployContract("IndexFiFactory", [core, 1, adapter]);
  const receipt = await factory.deploymentTransaction().wait();

  const manifest = {
    chainId: 31337,
    factory: await factory.getAddress(),
    deploymentBlock: Number(receipt.blockNumber),
    settlementToken: await usdt.getAddress(),
    settlementDecimals: 6,
    adapter: await adapter.getAddress(),
    localCore: await core.getAddress(),
    fixtureAccounts: {creator: creator.address, depositor: depositor.address},
    assets: [
      {address: await eth.getAddress(), symbol: "ETH", decimals: 18, ...REFERENCES.ETH},
      {address: await btc.getAddress(), symbol: "BTCB", decimals: 8, ...REFERENCES.BTCB},
    ],
  };
  const deploymentDir = path.resolve(__dirname, "../deployments");
  const frontendDir = path.resolve(__dirname, "../../../frontend/apps/web/public/deployments");
  fs.mkdirSync(deploymentDir, {recursive: true});
  fs.mkdirSync(frontendDir, {recursive: true});
  const body = JSON.stringify(manifest, null, 2) + "\n";
  fs.writeFileSync(path.join(deploymentDir, "31337.json"), body);
  fs.writeFileSync(path.join(frontendDir, "31337.json"), body);
  fs.writeFileSync(path.join(deploymentDir, "IndexFiFactory.abi.json"),
    JSON.stringify((await hre.artifacts.readArtifact("IndexFiFactory")).abi, null, 2) + "\n");
  fs.writeFileSync(path.join(deploymentDir, "IndexFiVault.abi.json"),
    JSON.stringify((await hre.artifacts.readArtifact("IndexFiVault")).abi, null, 2) + "\n");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
