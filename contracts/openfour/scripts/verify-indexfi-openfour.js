const {ethers} = require("hardhat");
const {connectFork, loadRegistration} = require("./lib/demo");

const CREATE_ARGS =
  "tuple(uint256 requestId,uint256 presetId,uint256 validTimestamp,uint256 createFee,uint256 presaleQuote,bool antiSniperEnabled,address partner,tuple(string name,string symbol,string tokenUri,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,bytes32 tokenSalt,bytes tokenParams,bytes vaultParams,bytes curveParams,bytes tradeParams,bytes migrateParams,bytes customDataParams) initParams)";

async function main() {
  const {signer, chainId, addresses} = await connectFork(require("hardhat"));
  const {registration} = loadRegistration("indexfi");
  if (registration.registry.toLowerCase() !== addresses.registry.toLowerCase()) {
    throw new Error("IndexFi registration belongs to another OpenFour fork");
  }

  const usdt = await ethers.deployContract("MockAsset", ["Test USDT", "USDT", 6]);
  const eth = await ethers.deployContract("MockAsset", ["Ether", "ETH", 18]);
  const btc = await ethers.deployContract("MockAsset", ["Bitcoin", "BTCB", 8]);
  const adapter = await ethers.deployContract("MockIndexFiAdapter", [await usdt.getAddress()]);
  await (await adapter.setPrice(await eth.getAddress(), 2_000n * 10n ** 6n)).wait();
  await (await adapter.setPrice(await btc.getAddress(), 80_000n * 10n ** 6n)).wait();
  await (await eth.mint(await adapter.getAddress(), 10_000n * 10n ** 18n)).wait();
  await (await btc.mint(await adapter.getAddress(), 1_000n * 10n ** 8n)).wait();
  await (await usdt.mint(await adapter.getAddress(), 10_000_000n * 10n ** 6n)).wait();
  await (await usdt.mint(signer.address, 1_000n * 10n ** 6n)).wait();

  const factory = await ethers.deployContract("IndexFiFactory", [
    addresses.core,
    BigInt(registration.presetId),
    await adapter.getAddress(),
  ]);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  const basket = {
    name: "OpenFour IndexFi",
    symbol: "OFI",
    metadataURI: "ipfs://indexfi-openfour-verification",
    constituents: [
      {token: await eth.getAddress(), weightBps: 5000},
      {token: await btc.getAddress(), weightBps: 5000},
    ],
  };
  const seed = 100n * 10n ** 6n;
  const deadline = BigInt((await ethers.provider.getBlock("latest")).timestamp) + 3600n;
  const vaultParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "tuple(address token,uint16 weightBps)[]", "address", "address"],
    [signer.address, basket.constituents, await adapter.getAddress(), factoryAddress],
  );
  const args = {
    requestId: 1n,
    presetId: BigInt(registration.presetId),
    validTimestamp: deadline,
    createFee: 0n,
    presaleQuote: 0n,
    antiSniperEnabled: false,
    partner: ethers.ZeroAddress,
    initParams: {
      name: basket.name,
      symbol: basket.symbol,
      tokenUri: basket.metadataURI,
      maxSupply: 0n,
      saleAmount: 0n,
      raiseAmount: 0n,
      quoteAsset: await usdt.getAddress(),
      tokenSalt: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256"], [factoryAddress, signer.address, 1n],
      )),
      tokenParams: "0x",
      vaultParams,
      curveParams: "0x",
      tradeParams: "0x",
      migrateParams: "0x",
      customDataParams: "0x",
    },
  };
  const createArgs = ethers.AbiCoder.defaultAbiCoder().encode([CREATE_ARGS], [args]);
  const payload = ethers.solidityPacked(
    ["string", "uint256", "address", "bytes32"],
    ["createOpenFourToken", chainId, factoryAddress, ethers.keccak256(createArgs)],
  );
  const signature = await signer.signMessage(ethers.getBytes(ethers.keccak256(payload)));
  const minimums = Array.from(await factory.previewCreate(basket, seed));
  await (await usdt.approve(factoryAddress, seed)).wait();
  const tx = await factory.createVault(basket, seed, minimums, deadline, signature);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("IndexFi OpenFour creation failed");
  const vaultAddress = await factory.vaultAt(0);
  const vault = await ethers.getContractAt("IndexFiVault", vaultAddress);
  const result = {
    status: "passed",
    core: addresses.core,
    presetId: registration.presetId,
    factory: factoryAddress,
    vault: vaultAddress,
    creator: await vault.creator(),
    shares: (await vault.balanceOf(signer.address)).toString(),
    costBasisUSDT: (await vault.costBasisUSDT(signer.address)).toString(),
    transaction: receipt.hash,
  };
  if (result.creator.toLowerCase() !== signer.address.toLowerCase() || result.shares !== (100n * 10n ** 18n).toString()) {
    throw new Error("Created OpenFour vault has incorrect creator or seed shares");
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
