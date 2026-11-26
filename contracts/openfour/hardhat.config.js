require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async (args, _hre, runSuper) => {
  if (args.solcVersion !== "0.8.24") return runSuper(args);
  return {compilerPath: require.resolve("solc/soljson.js"), isSolcJs: true,
    version: "0.8.24", longVersion: require("solc").version()};
});
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const BSC_TESTNET_RPC =
  process.env.BSC_TESTNET_RPC_URL || process.env.RPC_URL || "https://bsc-testnet.publicnode.com";
if (/api[_-]?key|apikey|token=|private/i.test(BSC_TESTNET_RPC) || /\/\/[^/]*:[^@/]+@/.test(BSC_TESTNET_RPC)) {
  throw new Error(
    "Do not use a private RPC URL in this toolkit. Use https://bsc-testnet.publicnode.com (or another public RPC).",
  );
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "paris",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      initialBaseFeePerGas: 0,
      // Tests replay Atlas payloads captured 2026-11-26 ~09:04Z, so the test chain starts before them. Only for `test`:
      // a local `hardhat node` keeps the real clock, which live signed prices require.
      ...(process.argv.includes("test") ? {initialDate: "2026-11-26T08:00:00Z"} : {}),
    },
    localhost: {
      url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
      chainId: 31337,
    },
    bsctestnet: {
      url: BSC_TESTNET_RPC,
      chainId: 97,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
    tests: "./test",
  },
};
