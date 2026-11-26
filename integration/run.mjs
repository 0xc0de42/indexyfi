// End-to-end V5 integration on a disposable local stack (chain 31337 only).
// 1. Starts Hardhat, deploys the V5 fixture, syncs the manifest into the frontend.
// 2. Starts the production market server fed by synthetic Atlas frames, and Next.js.
// 3. Browser E2E: create a vault, deposit, redeem (10 bps creator fee), directory row.
// 4. Runs the V5 three-service Vitest smoke (lib/integration-v5.test.ts) against the same stack.
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'..');
const require=createRequire(import.meta.url);
const {ethers}=require(resolve(root,'contracts/openfour/node_modules/ethers'));
const rpc='http://127.0.0.1:18545', backend='http://127.0.0.1:18000', web='http://127.0.0.1:13000';
const work=mkdtempSync(join(tmpdir(),'indexfi-e2e-'));
const children=[];
// `next dev` rewrites these for the alternate distDir; restore them afterwards.
const generated=['tsconfig.json','next-env.d.ts'].map(f=>resolve(root,'frontend/apps/web',f)).map(path=>({path,content:readFileSync(path,'utf8')}));
const logs=[];

function start(name,command,args,cwd,env={},stdio='pipe'){
  const child=spawn(command,args,{cwd,env:{...process.env,...env,HARDHAT_DISABLE_TELEMETRY_PROMPT:'true'},stdio:['ignore',stdio,stdio],detached:true});
  children.push(child);
  if(stdio==='pipe')for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs.push(`[${name}] ${chunk}`));
  child.on('exit',code=>{if(code&&code!==0)logs.push(`[${name}] exited ${code}\n`);});
  return child;
}
const finished=(child,label)=>new Promise((ok,fail)=>child.on('exit',code=>code===0?ok():fail(Error(`${label} failed (exit ${code})`))));
async function wait(url,body){
  const end=Date.now()+90_000;
  while(Date.now()<end){
    try{const response=await fetch(url,body);if(response.ok)return response;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error(`Timed out waiting for ${url}`);
}
function assert(value,message){if(!value)throw Error(message);}
// Matches viem formatUnits used by the UI (no trailing ".0").
const units=(value,decimals)=>ethers.formatUnits(value,decimals).replace(/\.0$/,'');

try{
  const contracts=resolve(root,'contracts/openfour');
  start('chain','npx',['hardhat','node','--hostname','127.0.0.1','--port','18545'],contracts);
  await wait(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});
  await finished(start('deploy','npx',['hardhat','run','scripts/deploy-indexfi.js','--network','localhost'],contracts,{LOCAL_RPC_URL:rpc}),'Fixture deployment');
  await finished(start('sync','node',['integration/sync-deployment.mjs','31337'],root),'Manifest sync');
  const manifest=JSON.parse(readFileSync(resolve(root,'frontend/apps/web/public/deployments/31337.json'),'utf8'));
  assert(manifest.schemaVersion===5&&manifest.fixture===true,'Synced manifest is not a V5 fixture');

  start('backend',resolve(root,'backend/.venv/bin/python'),['integration/market_fixture.py','--port','18000','--origin',web,'--history',join(work,'history')],root);
  await wait(`${backend}/snapshot`);
  start('frontend','npm',['run','dev','--','--port','13000'],resolve(root,'frontend/apps/web'),{
    NEXT_PUBLIC_VAULT_CHAIN_ID:'31337',NEXT_PUBLIC_VAULT_RPC_URL:rpc,PYTHON_API_URL:backend,NEXT_DIST_DIR:'.next-e2e',
  });
  await wait(web);
  await wait(`${web}/backend/snapshot`);

  const provider=new ethers.JsonRpcProvider(rpc);
  const erc20=['function balanceOf(address) view returns(uint256)'];
  const usdt=new ethers.Contract(manifest.settlementToken,erc20,provider);
  const {creator,depositor}=manifest.fixtureAccounts;
  let result;

  const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
  try{
    const context=await browser.newContext();
    await context.addInitScript(({rpc,accounts})=>{
      let selected=accounts[0];const listeners=new Map();let id=0;
      const emit=(event,value)=>{for(const callback of listeners.get(event)??[])callback(value);};
      window.__indexfiSetAccount=value=>{selected=value;emit('accountsChanged',[selected]);};
      window.ethereum={
        isMetaMask:true,
        request:async({method,params=[]})=>{
          if(method==='eth_requestAccounts'||method==='eth_accounts')return [selected];
          if(method==='wallet_switchEthereumChain'||method==='wallet_addEthereumChain')return null;
          if(method==='eth_chainId')return '0x7a69';
          const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
          const body=await response.json();if(body.error)throw Object.assign(Error(body.error.message),body.error);return body.result;
        },
        on:(event,callback)=>{const set=listeners.get(event)??new Set();set.add(callback);listeners.set(event,set);},
        removeListener:(event,callback)=>listeners.get(event)?.delete(callback),
      };
    },{rpc,accounts:[creator,depositor]});
    const page=await context.newPage();

    // Create: default 100 USDT seed + 10 USDT separate AMM liquidity, ETH/BTCB 50/50.
    await page.goto(`${web}/create`);
    await page.getByRole('button',{name:'Connect wallet'}).click();
    await page.getByLabel('Portfolio name').fill('E2E Blue Chips');
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/ETH Binance Pegged ETH/}).click();
    await page.getByRole('button',{name:/BTCB Binance Pegged Bitcoin/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    const launch=page.getByRole('button',{name:'Launch vault'});
    await launch.waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Launch vault'))?.disabled,null,{timeout:30_000});
    await launch.click();
    await page.waitForURL(/\/portfolio\/0x/i,{timeout:60_000});
    const vaultAddress=page.url().split('/').pop();
    assert(vaultAddress&&ethers.isAddress(vaultAddress),'Create did not route to a vault');
    await page.getByText('OpenFour portfolio').waitFor({timeout:30_000});
    await page.getByText('Migrated',{exact:true}).waitFor({timeout:30_000});
    assert((await (await fetch(`${backend}/snapshot`)).json()).prices.length===66,'Backend did not publish the complete registry');

    const vault=new ethers.Contract(vaultAddress,[
      'function token() view returns(address)',
      'function previewRedeem(address,uint256) view returns(uint256,uint256,uint256)',
      'function previewRedeemInKind(address,uint256) view returns(uint256[],uint256[],uint256[])',
    ],provider);
    const factory=new ethers.Contract(manifest.factory,['function isVault(address) view returns(bool)'],provider);
    assert(await factory.isVault(vaultAddress),'Factory does not recognise the launched vault');
    const token=new ethers.Contract(await vault.token(),erc20,provider);

    // Deposit 100 USDT as the depositor; 0.1% goes to the creator.
    await page.evaluate(account=>window.__indexfiSetAccount(account),depositor);
    const creatorBeforeDeposit=await usdt.balanceOf(creator);
    await page.getByTestId('vault-amount').fill('100');
    await page.getByText('Expected tokens').waitFor({timeout:15_000});
    await page.getByTestId('vault-submit').click();
    let shares=0n;
    for(const end=Date.now()+30_000;Date.now()<end&&shares===0n;await new Promise(r=>setTimeout(r,250)))shares=await token.balanceOf(depositor);
    assert(shares>0n,'Deposit did not issue portfolio tokens');
    await page.getByTestId('wallet-shares').getByText(units(shares,18),{exact:true}).waitFor({timeout:30_000});
    const depositFee=(await usdt.balanceOf(creator))-creatorBeforeDeposit;
    assert(depositFee===100n*10n**6n*10n/10000n,`Deposit creator fee was ${depositFee}, expected 0.1 USDT`);

    // USDT exit for half the position (per-leg sell minimums), exact settlement.
    const half=shares/2n, rest=shares-half;
    await page.locator('.segmented button',{hasText:/^Redeem$/}).click();
    await page.getByTestId('vault-amount').fill(ethers.formatUnits(half,18));
    const [gross,fee,net]=await vault.previewRedeem(depositor,half);
    assert(fee===gross*10n/10000n&&net===gross-fee,'Redeem preview fee is not 10 bps');
    await page.getByTestId('net-quote').getByText(`${units(net,6)} USDT`,{exact:true}).waitFor({timeout:15_000});
    const creatorBefore=await usdt.balanceOf(creator), depositorBefore=await usdt.balanceOf(depositor);
    await page.getByTestId('vault-submit').click();
    await page.getByTestId('wallet-shares').getByText(units(rest,18),{exact:true}).waitFor({timeout:30_000});
    const creatorFee=(await usdt.balanceOf(creator))-creatorBefore, received=(await usdt.balanceOf(depositor))-depositorBefore;
    assert(creatorFee===fee,`Creator received ${creatorFee}, expected redeem fee ${fee}`);
    assert(received===net,`Depositor received ${received}, expected net ${net}`);

    // In-kind exit for the rest: underlying tokens, no swaps, 10 bps of each to the creator.
    const legs=await Promise.all(manifest.assets.map(a=>new ethers.Contract(a.address,erc20,provider)));
    const [kindGross,kindFees,kindNet]=await vault.previewRedeemInKind(depositor,rest);
    await page.locator('.segmented button',{hasText:/^Redeem in kind$/}).click();
    await page.getByTestId('vault-amount').fill(ethers.formatUnits(rest,18));
    await page.getByText(`${units(kindNet[0],manifest.assets[0].decimals)} ${manifest.assets[0].symbol}`,{exact:true}).waitFor({timeout:15_000});
    const legBalances=who=>Promise.all(legs.map(l=>l.balanceOf(who)));
    const [dep0,cre0]=await Promise.all([legBalances(depositor),legBalances(creator)]);
    await page.getByTestId('vault-submit').click();
    await page.getByTestId('wallet-shares').getByText('0',{exact:true}).waitFor({timeout:30_000});
    const [dep1,cre1]=await Promise.all([legBalances(depositor),legBalances(creator)]);
    kindGross.forEach((g,k)=>{
      assert(kindFees[k]===g*10n/10000n,`In-kind fee for ${manifest.assets[k].symbol} is not 10 bps`);
      assert(dep1[k]-dep0[k]===kindNet[k],`Depositor received wrong ${manifest.assets[k].symbol}`);
      assert(cre1[k]-cre0[k]===kindFees[k],`Creator received wrong ${manifest.assets[k].symbol} fee`);
    });
    assert((await token.balanceOf(depositor))===0n,'Depositor still holds portfolio tokens');

    await page.goto(web);
    await page.getByTestId('onchain-vault-row').first().waitFor({timeout:30_000});
    result={vault:vaultAddress,backendPrices:66,depositUSDT:'100',depositFeeUSDT:ethers.formatUnits(depositFee,6),
      sharesIssued:ethers.formatUnits(shares,18),usdtExit:{shares:ethers.formatUnits(half,18),grossUSDT:ethers.formatUnits(gross,6),feeUSDT:ethers.formatUnits(fee,6),netUSDT:ethers.formatUnits(net,6)},
      inKindExit:Object.fromEntries(manifest.assets.map((a,k)=>[a.symbol,{net:ethers.formatUnits(kindNet[k],a.decimals),creatorFee:ethers.formatUnits(kindFees[k],a.decimals)}]))};
    console.log(JSON.stringify({browserE2E:'passed',...result},null,2));
  }finally{await browser.close();}

  // V5 three-service smoke against the same chain, backend and Next proxy.
  await finished(start('smoke','corepack',['pnpm','exec','vitest','run','lib/integration-v5.test.ts'],resolve(root,'frontend/apps/web'),{
    INDEXFI_V5_SMOKE:'1',NEXT_PUBLIC_VAULT_CHAIN_ID:'31337',NEXT_PUBLIC_VAULT_RPC_URL:rpc,INDEXFI_PROXY_URL:`${web}/backend`,
  },'inherit'),'V5 smoke');
  console.log(JSON.stringify({status:'passed',browserE2E:'passed',v5Smoke:'passed'},null,2));
}catch(error){
  console.error(error);console.error(logs.slice(-120).join(''));process.exitCode=1;
}finally{
  for(const child of children.reverse())if(child.exitCode===null){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  rmSync(work,{recursive:true,force:true});
  for(const {path,content} of generated)writeFileSync(path,content);
}
