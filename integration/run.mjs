import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
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
const logs=[];

function start(name,command,args,cwd,env={}){
  const child=spawn(command,args,{cwd,env:{...process.env,...env,HARDHAT_DISABLE_TELEMETRY_PROMPT:'true'},stdio:['ignore','pipe','pipe'],detached:true});
  children.push(child);
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs.push(`[${name}] ${chunk}`));
  child.on('exit',code=>{if(code&&code!==0)logs.push(`[${name}] exited ${code}\n`);});
  return child;
}
async function wait(url,body){
  const end=Date.now()+45_000;
  while(Date.now()<end){
    try{const response=await fetch(url,body);if(response.ok)return response;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error(`Timed out waiting for ${url}`);
}
async function rpcCall(method,params=[]){
  const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const body=await response.json();if(body.error)throw Error(body.error.message);return body.result;
}
function assert(value,message){if(!value)throw Error(message);}

try{
  start('chain','npx',['hardhat','node','--hostname','127.0.0.1','--port','18545'],resolve(root,'contracts/openfour'));
  await wait(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});
  const deploy=start('deploy','npx',['hardhat','run','scripts/deploy-indexfi.js','--network','localhost'],resolve(root,'contracts/openfour'),{LOCAL_RPC_URL:rpc});
  await new Promise((resolve,reject)=>deploy.on('exit',code=>code===0?resolve():reject(Error('Fixture deployment failed'))));
  const manifest=JSON.parse(readFileSync(resolve(root,'contracts/openfour/deployments/31337.json'),'utf8'));

  start('backend',resolve(root,'backend/.venv/bin/python'),['integration/market_fixture.py','--port','18000','--origin',web,'--history',join(work,'history')],root);
  await wait(`${backend}/snapshot`);
  start('frontend','npm',['run','dev','--','--port','13000'],resolve(root,'frontend/apps/web'),{
    NEXT_PUBLIC_VAULT_CHAIN_ID:'31337',NEXT_PUBLIC_VAULT_RPC_URL:rpc,PYTHON_API_URL:backend,
  });
  await wait(web);

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
    },{rpc,accounts:[manifest.fixtureAccounts.creator,manifest.fixtureAccounts.depositor]});
    const page=await context.newPage();
    await page.goto(`${web}/create`);
    await page.getByRole('button',{name:'Connect wallet'}).click();
    await page.getByLabel('Portfolio name').fill('E2E Blue Chips');
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/ETH Binance Pegged ETH/}).click();
    await page.getByRole('button',{name:/BTCB Binance Pegged Bitcoin/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:/Continue/}).click();
    await page.getByRole('button',{name:'Launch vault'}).click();
    await page.waitForURL(/\/portfolio\/0x/i,{timeout:30_000});
    const vault=page.url().split('/').pop();
    assert(vault&&ethers.isAddress(vault),'Create did not route to a vault');
    await page.getByText('Public basket vault').waitFor();
    assert((await (await fetch(`${backend}/snapshot`)).json()).prices.length===66,'Backend did not publish the complete registry');

    await page.evaluate(account=>window.__indexfiSetAccount(account),manifest.fixtureAccounts.depositor);
    await page.getByTestId('vault-amount').fill('100');
    await page.getByTestId('vault-submit').click();
    await page.getByTestId('wallet-shares').getByText('100').waitFor({timeout:30_000});

    const provider=new ethers.JsonRpcProvider(rpc);
    const owner=await provider.getSigner(0);
    const adapter=new ethers.Contract(manifest.adapter,['function setPrice(address,uint256)'],owner);
    await (await adapter.setPrice(manifest.assets[0].address,2_400n*10n**6n)).wait();
    await (await adapter.setPrice(manifest.assets[1].address,96_000n*10n**6n)).wait();
    const usdt=new ethers.Contract(manifest.settlementToken,['function balanceOf(address) view returns(uint256)'],provider);
    const creatorBefore=await usdt.balanceOf(manifest.fixtureAccounts.creator);
    await page.getByRole('button',{name:'Redeem'}).click();
    await page.getByTestId('vault-amount').fill('100');
    await page.getByTestId('net-quote').getByText(/118/).waitFor({timeout:15_000});
    await page.getByTestId('vault-submit').click();
    await page.getByTestId('wallet-shares').getByText('0').waitFor({timeout:30_000});
    const creatorAfter=await usdt.balanceOf(manifest.fixtureAccounts.creator);
    assert(creatorAfter-creatorBefore===2n*10n**6n,'Creator did not receive the 10% realized-profit fee');
    await page.goto(web);
    await page.getByTestId('onchain-vault-row').waitFor();
    console.log(JSON.stringify({status:'passed',vault,backendPrices:66,depositShares:'100',grossUSDT:'120',creatorFeeUSDT:'2',netUSDT:'118'},null,2));
  }finally{await browser.close();}
}catch(error){
  console.error(error);console.error(logs.slice(-120).join(''));process.exitCode=1;
}finally{
  for(const child of children.reverse())if(!child.killed){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  rmSync(work,{recursive:true,force:true});
}
