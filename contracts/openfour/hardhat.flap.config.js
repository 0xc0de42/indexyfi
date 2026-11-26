// Flap V3 suite: artifacts come from scripts/compile-flap-selected.cjs (viaIR, optimizer 200, Paris), so they live apart
// from the main build, and the suite has its own test folder so plain `npx hardhat test` runs only the OpenFour suites.
//   node scripts/compile-flap-selected.cjs && npx hardhat test --config hardhat.flap.config.js --no-compile
const config=require('./hardhat.config');
module.exports={...config,paths:{...config.paths,artifacts:'./flap-artifacts',cache:'./flap-cache',tests:'./test-flap'}};
