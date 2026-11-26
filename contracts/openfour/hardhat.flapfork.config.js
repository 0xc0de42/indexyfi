// Local fork of BSC testnet (chain 97) for Flap acceptance probes against the REAL Portal / Dock / whitelist helper.
// Nothing is broadcast: the fork runs in-process. Uses flap-artifacts from scripts/compile-flap-selected.cjs.
//   FLAP_FORK_BLOCK=<n> npx hardhat run --config hardhat.flapfork.config.js scripts/flap-fork-launch.cjs
const config = require('./hardhat.flap.config');
const url = process.env.BSC_TESTNET_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com';
module.exports = {
  ...config,
  networks: {
    ...config.networks,
    hardhat: {
      chainId: 97,
      initialBaseFeePerGas: 0,
      forking: {url, ...(process.env.FLAP_FORK_BLOCK ? {blockNumber: Number(process.env.FLAP_FORK_BLOCK)} : {})},
      chains: {97: {hardforkHistory: {cancun: 0}}},
    },
  },
};
