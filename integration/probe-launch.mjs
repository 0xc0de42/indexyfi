// Diagnostic: drive /create on the running stack with an injected wallet and report the Launch state.
// Usage: node probe-launch.mjs <account> <chainIdHex> [click]
import {chromium} from 'playwright-core';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ethers}=require('../contracts/openfour/node_modules/ethers');
const [account,chainHex,click]=process.argv.slice(2);
const web='http://127.0.0.1:3000',rpc='http://127.0.0.1:8545';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
  const context=await browser.newContext();
  // With PROBE_KEY set, sign locally like MetaMask instead of relying on node-unlocked accounts.
  const signer=process.env.PROBE_KEY?new ethers.Wallet(process.env.PROBE_KEY,new ethers.JsonRpcProvider(rpc)):null;
  await context.exposeFunction('__probeSend',async tx=>{
    const nonce=Number(await signer.provider.send('eth_getTransactionCount',[signer.address,'pending']));
    const sent=await signer.sendTransaction({nonce,to:tx.to,data:tx.data,value:tx.value?BigInt(tx.value):0n,gasLimit:tx.gas?BigInt(tx.gas):undefined});
    return sent.hash;});
  await context.addInitScript(({rpc,account,chainHex})=>{
    let id=0;window.ethereum={isMetaMask:true,
      request:async({method,params=[]})=>{
        if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];
        if(method==='eth_chainId')return chainHex;
        if(method==='eth_sendTransaction'&&window.__probeLocalSign)return window.__probeSend(params[0]);
        if(method==='wallet_switchEthereumChain'||method==='wallet_addEthereumChain')throw Object.assign(Error('User rejected'),{code:4001});
        const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
        const b=await r.json();if(b.error)throw Object.assign(Error(b.error.message),b.error);return b.result;},
      on:()=>{},removeListener:()=>{}};
  },{rpc,account,chainHex});
  if(signer)await context.addInitScript(()=>{window.__probeLocalSign=true;});
  const page=await context.newPage();
  await page.goto(`${web}/create`);
  await page.getByRole('button',{name:'Connect wallet'}).click();
  await page.getByLabel('Portfolio name').fill('Probe Basket');
  await page.getByRole('button',{name:/Continue/}).click();
  await page.getByRole('button',{name:/SOL /}).first().click();
  await page.getByRole('button',{name:/XRP /}).first().click();
  for(let i=0;i<3;i++)await page.getByRole('button',{name:/Continue/}).click();
  const launch=page.getByRole('button',{name:'Launch vault'});
  await page.waitForTimeout(6000);
  const state=await page.evaluate(()=>({
    disabled:[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Launch vault'))?.disabled,
    alerts:[...document.querySelectorAll('[role=alert],[role=status],.notice')].map(n=>n.textContent?.trim()).filter(Boolean),
    quote:[...document.querySelectorAll('dt')].find(d=>d.textContent==='Execution quote')?.nextElementSibling?.textContent}));
  console.log(JSON.stringify(state));
  if(click&&await page.getByTestId('get-test-funds').count()){
    await page.getByTestId('get-test-funds').click();
    await page.waitForFunction(()=>!document.querySelector('[data-testid=launch-blocker]'),null,{timeout:30_000});
    state.disabled=await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Launch vault'))?.disabled);
    console.log(JSON.stringify({afterTestFunds:{disabled:state.disabled}}));
  }
  if(click&&!state.disabled){await launch.click();await page.waitForTimeout(8000);
    console.log(JSON.stringify({url:page.url(),alerts:await page.evaluate(()=>[...document.querySelectorAll('[role=alert],[role=status]')].map(n=>n.textContent?.trim()))}));}
}finally{await browser.close();}
