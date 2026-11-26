// All mock contracts are restricted to chain 31337 in scripts. No testnet writes.
async function deployFixtureServices(ethers) {
  if ((await ethers.provider.getNetwork()).chainId !== 31337n) throw new Error("Fixture requires chain 31337");
  const [owner,creator,investor] = await ethers.getSigners();
  const usdt=await ethers.deployContract("MockAsset",["Test USDT","USDT",6]);
  const eth=await ethers.deployContract("MockAsset",["Ether","ETH",18]);
  const btc=await ethers.deployContract("MockAsset",["Bitcoin","BTCB",8]);
  const oracle=await ethers.deployContract("MockIndexFiOracle",[usdt]);
  await oracle.setPrice(eth,2000n*10n**18n);await oracle.setPrice(btc,80000n*10n**18n);
  const dex=await ethers.deployContract("MockV2Factory");const router=await ethers.deployContract("MockV2Router",[dex]);
  for(const [asset,amount] of [[eth,10000n*10n**18n],[btc,250n*10n**8n]]) {
    await dex.createPair(usdt,asset);const pair=await dex.getPair(usdt,asset);
    await usdt.mint(pair,20_000_000n*10n**6n);await asset.mint(pair,amount);
    await (await ethers.getContractAt("MockV2Pair",pair)).mint(owner.address);
  }
  const cash=await usdt.getAddress();
  const adapter=await ethers.deployContract("PancakeV2BasketAdapter",[usdt,router,[
    {asset:await eth.getAddress(),buyPath:[cash,await eth.getAddress()]},
    {asset:await btc.getAddress(),buyPath:[cash,await btc.getAddress()]}]]);
  for(const account of [owner,creator,investor]) await usdt.mint(account.address,10000n*10n**6n);
  return {usdt,eth,btc,oracle,dex,router,adapter,owner,creator,investor};
}
async function deployFixtureCore(ethers) {
  const token=await ethers.deployContract("OpenFourToken");
  const vault=await ethers.deployContract("IndexFiVault");
  const migration=await ethers.deployContract("IndexFiMigrateModule");
  const tokenModule=await ethers.deployContract("StandardTokenModule");
  return ethers.deployContract("MockIndexFiCore",[token,vault,migration,tokenModule]);
}
module.exports={deployFixtureServices,deployFixtureCore};
