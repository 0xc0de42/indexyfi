import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const chain=Number(process.argv[2]??31337);
if(![97,31337].includes(chain))throw Error('Unsupported chain');
const dir=resolve(root,'contracts/openfour/deployments');
const source=resolve(dir,`${chain}.json`);
const manifest=JSON.parse(readFileSync(source,'utf8'));
const addr=x=>typeof x==='string'&&/^0x[0-9a-f]{40}$/i.test(x)&&!/^0x0{40}$/i.test(x);
if(manifest.schemaVersion!==5||manifest.chainId!==chain||manifest.fixture!==(chain===31337)||manifest.supplyModel!=='standard-openfour-inventory')throw Error('Invalid V5 deployment');
for(const key of ['factory','settlementToken','router','oracle','adapter'])if(!addr(manifest[key]))throw Error(`Invalid ${key}`);
const selected=JSON.parse(readFileSync(resolve(root,'backend/registry/selected.json'),'utf8'));
const refs=new Map(selected.assets.map(a=>[a.asset_id,a.feed_id]));
if(!selected.verified||!Array.isArray(manifest.assets)||manifest.assets.length===0||manifest.assets.some(a=>!addr(a.address)||refs.get(a.referenceAssetId)!==a.feedId||(!manifest.fixture&&a.isMock)))throw Error('Invalid execution registry mapping');
if(new Set(manifest.assets.map(a=>a.referenceAssetId)).size!==manifest.assets.length)throw Error('Duplicate reference asset');
for(const name of ['IndexFiFactory','IndexFiVault','OpenFourToken']){
  const abi=JSON.parse(readFileSync(resolve(dir,`${name}.abi.json`),'utf8'));
  if(!Array.isArray(abi))throw Error(`Missing compiled ABI ${name}`);
  const fn=(n,inputs)=>abi.some(x=>x.type==='function'&&x.name===n&&(inputs===undefined||x.inputs.length===inputs));
  if(name==='IndexFiFactory'&&!(fn('createVault',8)&&fn('isVault',1)&&fn('usedRequestIds',1)))throw Error('Legacy factory ABI');
  if(name==='IndexFiVault'&&(!(fn('outstandingSupply')&&fn('redeem',4)&&fn('redeemInKind',3)&&fn('previewRedeemAssets',2))||abi.some(x=>x.name==='costBasisUSDT')))throw Error('Legacy vault ABI');
}
const target=resolve(root,'frontend/apps/web/public/deployments');mkdirSync(target,{recursive:true});
const path=resolve(target,`${chain}.json`);writeFileSync(`${path}.tmp`,JSON.stringify(manifest,null,2)+'\n');renameSync(`${path}.tmp`,path);
console.log(`Synchronized V5 manifest for chain ${chain}: ${path}`);
