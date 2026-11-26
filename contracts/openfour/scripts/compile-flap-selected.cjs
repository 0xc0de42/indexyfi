const fs=require('fs'),path=require('path');const root=process.cwd(),solc=require(path.join(root,'node_modules/solc'));
const selections={
 'contracts/flap/IndexFiFlapFactory.sol':['IndexFiFlapFactory'],
 'contracts/flap/IndexFiFlapLauncher.sol':['IndexFiFlapLauncher'],
 'contracts/flap/IndexFiFlapVault.sol':['IndexFiFlapVault'],
 'contracts/flap/IndexFiFlapVaultFactory.sol':['IndexFiFlapVaultFactory'],
 'contracts/flap/test/MockSignedFlapOracle.sol':['MockSignedFlapOracle'],
 'contracts/flap/test/MockFlap.sol':['MockFlapToken','MockFlapDock','MockFlapPortal'],
 'contracts/helpers/MockAsset.sol':['MockAsset'],
 'contracts/helpers/MockIndexFiOracle.sol':['MockIndexFiOracle'],
 'contracts/helpers/MockIndexFiAdapter.sol':['MockIndexFiAdapter'],
 'contracts/helpers/MockV2.sol':['MockV2Factory','MockV2Router','MockV2Pair'],
 'contracts/interfaces/IIndexFi.sol':['IIndexFiFactory','IIndexFiVault'],
 'contracts/IndexFiFactory.sol':['IndexFiFactory'],
 'contracts/modules/vault/IndexFiVault.sol':['IndexFiVault']
};
if(process.env.FLAP_ONLY){const wanted=new Set(process.env.FLAP_ONLY.split(','));for(const file of Object.keys(selections)){selections[file]=selections[file].filter(x=>wanted.has(x));if(!selections[file].length)delete selections[file];}}
const sources=Object.fromEntries(Object.keys(selections).map(f=>[f,{content:fs.readFileSync(f,'utf8')}]));
const outputSelection={};for(const [file,names] of Object.entries(selections)){outputSelection[file]={};for(const n of names) outputSelection[file][n]=['abi',...(file==='contracts/modules/vault/IndexFiVault.sol'||file==='contracts/IndexFiFactory.sol'?[]:['evm.bytecode','evm.deployedBytecode'])];}
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',outputSelection}};
const result=JSON.parse(solc.compile(JSON.stringify(input),{import:(f)=>{for(const p of [f,path.join('node_modules',f)])if(fs.existsSync(p))return{contents:fs.readFileSync(p,'utf8')};return{error:'missing '+f}}}));
for(const e of result.errors??[]) console.log(e.formattedMessage);if((result.errors??[]).some(e=>e.severity==='error'))process.exit(1);
let count=0;for(const [sourceName,contracts] of Object.entries(result.contracts)){for(const [contractName,c] of Object.entries(contracts)){const dir=path.join('flap-artifacts',sourceName);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,contractName+'.json'),JSON.stringify({_format:'hh-sol-artifact-1',contractName,sourceName,abi:c.abi,bytecode:'0x'+(c.evm?.bytecode?.object??''),deployedBytecode:'0x'+(c.evm?.deployedBytecode?.object??''),linkReferences:c.evm?.bytecode?.linkReferences??{},deployedLinkReferences:c.evm?.deployedBytecode?.linkReferences??{}},null,2));console.log(contractName,'runtime bytes',(c.evm?.deployedBytecode?.object?.length??0)/2,'init bytes',(c.evm?.bytecode?.object?.length??0)/2);++count;}}
console.log('Compiled',count,'selected contracts with solc',solc.version());
