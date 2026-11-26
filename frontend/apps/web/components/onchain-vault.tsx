'use client';
import Link from 'next/link';
import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {Badge, Button, Card, Empty, Metric} from '@indexfi/ui';
import {formatUnits, type Address} from 'viem';
import {useAccount} from 'wagmi';
import {usePriceState} from '@/lib/prices';
import {referenceAssetById} from '@/lib/catalog';
import {exactAmount, units, vaultAbi, routerAbi, lpAmounts, floorOutput, quoteDeposit} from '@/lib/vaults';
import {useDeployment, useVault, useVaultTransaction, type VaultAction} from '@/lib/use-vaults';

type Mode='deposit'|'redeem'|'redeemInKind'|'buy'|'sell'|'addLiquidity'|'removeLiquidity';
type Quote={action:VaultAction; lines:readonly [string,string][]; key:string};
const labels:Record<Mode,string>={deposit:'Deposit',redeem:'Redeem',redeemInKind:'Redeem in kind',buy:'Buy',sell:'Sell',addLiquidity:'Add liquidity',removeLiquidity:'Remove liquidity'};
const display=(v:bigint|null|undefined,decimals=18,digits=4)=>v==null?'Unavailable':Number(formatUnits(v,decimals)).toLocaleString('en-US',{maximumFractionDigits:digits});

export function OnchainVault({address}:{address:Address}) {
  const deployment=useDeployment();
  const account=useAccount();
  const vault=useVault(deployment.data,address);
  const transaction=useVaultTransaction(deployment.data);
  const prices=usePriceState();
  const [mode,setMode]=useState<Mode>('deposit');
  const [amount,setAmount]=useState('100');
  const [slip,setSlip]=useState('100');
  const [quote,setQuote]=useState<Quote|null>(null);
  const [quoteError,setQuoteError]=useState('');
  const slippage=Number(slip);
  const validSlip=slip.trim()!==''&&Number.isInteger(slippage)&&slippage>=0&&slippage<=1000;
  const key=[mode,amount,vault.data?.blockNumber,account.address,address].join(':');
  const current=quote?.key===key?quote:null;

  useEffect(()=>{
    let active=true;
    async function preview(){
      setQuote(null);setQuoteError('');
      const client=deployment.client,d=deployment.data,v=vault.data;
      if(!client||!d||!v||v.closed||v.phase!==3)return;
      const value=exactAmount(amount,mode==='deposit'||mode==='buy'||mode==='addLiquidity'?d.settlementDecimals:18);
      if(!value)return;
      const cash=(n:bigint)=>`${units(n,d.settlementDecimals)} USDT`;
      const shares=(n:bigint)=>`${units(n,18)} ${v.symbol}`;
      const publish=(action:VaultAction,lines:Quote['lines'])=>{if(active)setQuote({action,lines,key});};
      try {
        if(mode==='deposit'){
          const [out,outputs]=await quoteDeposit(client,d,address,v.holdings.map(h=>h.feedId),value);
          publish({kind:'deposit',vault:address,amount:value,shares:out,outputs},[['Creator fee (0.1%)',cash(value*10n/10000n)],['Expected tokens',shares(out)]]);
        } else if(mode==='redeem') {
          if(!account.address)throw Error('Connect your wallet to quote a redemption.');
          let gross:bigint,fee:bigint,net:bigint,legs:readonly bigint[];
          try{
            [[gross,fee,net],[,legs]]=await Promise.all([
              client.readContract({address,abi:vaultAbi,functionName:'previewRedeem',args:[account.address,value]}),
              client.readContract({address,abi:vaultAbi,functionName:'previewRedeemAssets',args:[account.address,value]})]);
          }catch{throw Error('A USDT swap route cannot quote this redemption.');}
          if(net===0n)throw Error('Redemption is too small to return USDT.');
          publish({kind:'redeem',vault:address,token:v.token,amount:value,net,legs},[['Gross proceeds',cash(gross)],['Creator fee',cash(fee)],['Net proceeds',cash(net)]]);
        } else if(mode==='redeemInKind') {
          if(!account.address)throw Error('Connect your wallet to quote a redemption.');
          const [,fees,net]=await client.readContract({address,abi:vaultAbi,functionName:'previewRedeemInKind',args:[account.address,value]});
          if(net.every(n=>n===0n))throw Error('Redemption is too small to return any asset.');
          publish({kind:'redeemInKind',vault:address,token:v.token,amount:value,net},v.holdings.flatMap((h,i)=>[
            [`${h.symbol} received`,`${units(net[i]??0n,h.decimals)} ${h.symbol}`],[`${h.symbol} creator fee`,`${units(fees[i]??0n,h.decimals)} ${h.symbol}`]] as [string,string][]));
        } else {
          if(!v.pool||v.pool.cash===0n||v.pool.shares===0n)throw Error('Secondary liquidity unavailable. Primary operations remain independent.');
          if(mode==='buy'||mode==='sell'){
            const buy=mode==='buy',path=buy?[d.settlementToken,v.token]:[v.token,d.settlementToken];
            const outputs=await client.readContract({address:d.router,abi:routerAbi,functionName:'getAmountsOut',args:[value,path]});
            const out=outputs.at(-1)??0n;if(out===0n)throw Error('Swap output is zero.');
            publish({kind:'swap',token:v.token,buy,amount:value,out},[['Expected output',buy?shares(out):cash(out)]]);
          } else if(mode==='addLiquidity'){
            const tokenAmount=value*v.pool.shares/v.pool.cash;
            if(tokenAmount===0n)throw Error('Liquidity amount too small.');
            publish({kind:'addLiquidity',token:v.token,cash:value,shares:tokenAmount},[['USDT contribution',cash(value)],['Token contribution',shares(tokenAmount)]]);
          } else {
            if(!account.address||value>v.pool.lpBalance)throw Error('Insufficient wallet LP balance.');
            const out=lpAmounts(value,v.pool.cash,v.pool.shares,v.pool.supply);
            if(out.cash===0n||out.shares===0n)throw Error('LP amount too small.');
            publish({kind:'removeLiquidity',token:v.token,pair:v.pair,amount:value,...out},[['Expected USDT',cash(out.cash)],['Expected tokens',shares(out.shares)]]);
          }
        }
      }catch(err){if(active)setQuoteError(err instanceof Error?err.message.split('\n')[0]:'Quote failed');}
    }
    void preview();return()=>{active=false;};
  },[amount,mode,address,deployment.client,deployment.data,vault.data,account.address,key]);

  const indicative=useMemo(()=>{
    if(!vault.data)return null;
    let aum=0;
    for(const holding of vault.data.holdings){
      const price=prices.byAsset.get(holding.referenceAssetId)?.price;
      if(!price)return null;
      aum+=Number(formatUnits(holding.balance,holding.decimals))*Number(price);
    }
    return vault.data.supply?aum/Number(formatUnits(vault.data.supply,18)):null;
  },[vault.data,prices.byAsset]);

  async function submit(){
    if(!current||!validSlip)return;
    if(await transaction.submit(current.action,slippage))await vault.refetch();
  }

  if(deployment.isLoading||vault.isLoading)return <div className="page-heading"><h1>Loading vault…</h1></div>;
  if(deployment.error||vault.error||!deployment.data||!vault.data)return <Empty>Vault unavailable on the active deployment. <Link href="/">Return to Explore</Link></Empty>;
  const v=vault.data,d=deployment.data;
  const market=v.pool?.marketPrice??null;
  const premium=market!==null&&v.nav!==null&&v.nav>0n?Number((market-v.nav)*10000n/v.nav)/100:null;
  const liquidity=v.pool&&market!==null?2n*v.pool.cash:null;
  const active=!v.closed&&v.phase===3;
  const minOut=current&&validSlip?(()=>{const a=current.action;switch(a.kind){case 'deposit':return `${units(floorOutput(a.shares,slippage),18)} ${v.symbol}`;case 'redeem':return `${units(floorOutput(a.net,slippage),d.settlementDecimals)} USDT`;case 'swap':return `${units(floorOutput(a.out,slippage),a.buy?18:d.settlementDecimals)} ${a.buy?v.symbol:'USDT'}`;default:return null;}})():null;
  return <>
    <Link className="back-link" href="/"><ArrowLeft size={15}/> All vaults</Link>
    <div className="detail-heading"><div className="detail-title"><span className="token-mark token-mark--large">{v.symbol.slice(0,2)}</span><div><div className="eyebrow">OpenFour portfolio · {d.fixture?'Local fixture':'On-chain'}</div><h1>{v.name}</h1><p>{v.symbol} · {address}</p></div></div><Badge tone={active?'good':'warn'}>{active?'Migrated':v.closed?'Closed':'Not active'}</Badge></div>
    <div className="detail-grid"><div className="stack">
      <Card><div className="card-heading"><h2>Portfolio valuation</h2><Badge>Block {v.blockNumber.toString()}</Badge></div><div className="price-metrics"><Metric label="On-chain NAV / token" value={display(v.nav)} detail={d.fixture?'Fixture oracle':'Atlas oracle'}/><Metric label="Market price" value={display(market)} detail={d.fixture?'Fixture AMM':'PancakeSwap V2'}/><Metric label="Premium / discount" value={premium===null?'—':`${premium.toFixed(2)}%`}/><Metric label="Collateral AUM (USD)" value={display(v.aum,18,2)}/><Metric label="Backed supply" value={display(v.supply)} /><Metric label="Unissued inventory" value={display(v.inventory)}/><Metric label="AMM liquidity (USDT at spot)" value={display(liquidity,d.settlementDecimals,2)} /><Metric label="Indicative backend NAV" value={indicative===null?'—':`$${indicative.toFixed(4)}`} detail="Backend reference feed; not execution price"/></div></Card>
      <Card><div className="card-heading"><h2>Actual collateral</h2><Badge>Accounted holdings</Badge></div><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Initial weight</th><th>Balance</th><th>Backend reference price</th></tr></thead><tbody>{v.holdings.map(h=><tr key={h.address}><td>{referenceAssetById(h.referenceAssetId)?.name??h.symbol}</td><td>{Number(h.weightBps)/100}%</td><td>{units(h.balance,h.decimals)} {h.symbol}</td><td>{prices.byAsset.get(h.referenceAssetId)?.price??'Unavailable'}</td></tr>)}</tbody></table></div></Card>
      <Card><h2>Transparency</h2><dl className="key-values"><div><dt>Creator</dt><dd className="address">{v.creator}</dd></div><div><dt>Portfolio ERC-20</dt><dd className="address">{v.token}</dd></div><div><dt>AMM pair</dt><dd className="address">{v.pair}</dd></div><div><dt>Your tokens</dt><dd data-testid="wallet-shares">{units(v.shares,18)}</dd></div><div><dt>Your LP tokens</dt><dd>{v.pool?units(v.pool.lpBalance,18):'Unavailable'}</dd></div><div><dt>Primary creator fees</dt><dd>0.1% per deposit and redemption</dd></div><div><dt>Liquidity ownership</dt><dd>LP token holders; unlocked</dd></div></dl></Card>
    </div><aside className="stack trade-column"><Card className="trade-panel"><div className="card-heading"><h2>{labels[mode]}</h2><Badge tone={transaction.ready?'good':'warn'}>{transaction.ready?'Wallet ready':'Connect wallet'}</Badge></div>
      {([['deposit','redeem','redeemInKind'],['buy','sell'],['addLiquidity','removeLiquidity']] as const).map((group,i)=><div key={i}><p className="fine-print">{['Primary market','Secondary market','Liquidity'][i]}</p><div className="segmented">{group.map(m=><button key={m} aria-pressed={mode===m} onClick={()=>{setMode(m);setQuote(null);}} disabled={!!transaction.pending}>{labels[m]}</button>)}</div></div>)}
      <label className="field">{mode==='deposit'||mode==='buy'||mode==='addLiquidity'?'USDT amount':mode==='removeLiquidity'?'LP token amount':'Portfolio token amount'}<input data-testid="vault-amount" value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" disabled={!!transaction.pending}/></label>
      <label className="field">Slippage tolerance (bps; 100 = 1%)<input value={slip} onChange={e=>setSlip(e.target.value)} inputMode="numeric" disabled={!!transaction.pending}/></label>
      {current&&<dl className="key-values">{current.lines.map(([label,value])=><div key={label}><dt>{label}</dt><dd data-testid={label==='Net proceeds'?'net-quote':undefined}>{value}</dd></div>)}{minOut&&<div><dt>Minimum received</dt><dd>{minOut}</dd></div>}</dl>}
      {mode==='addLiquidity'&&<p className="fine-print">The second token amount follows the current reserve ratio. Both amounts have slippage protection.</p>}
      {mode==='redeem'&&(quoteError||transaction.error)&&<div className="notice notice--neutral">The USDT exit needs every swap route. You can still exit with the underlying tokens. <button type="button" className="text-button" data-testid="switch-in-kind" onClick={()=>{setMode('redeemInKind');setQuote(null);}}>Redeem in kind instead</button></div>}
      {mode==='redeemInKind'&&<p className="fine-print">Pays your share of each underlying token directly. No swaps and no oracle; 0.1% of each token goes to the creator.</p>}
      {mode==='redeem'&&v.nav===null&&<p className="fine-print">Oracle valuation unavailable. Redemption can still proceed if swaps are executable.</p>}
      {(quoteError||transaction.error)&&<div role="alert" className="notice notice--bad">{quoteError||transaction.error}</div>}
      {transaction.pending&&<div role="status" className="notice notice--neutral">{transaction.pending}</div>}
      {transaction.lastHash&&!transaction.pending&&<p className="fine-print">Latest transaction: {transaction.lastHash}</p>}
      <Button data-testid="vault-submit" className="full-width" disabled={!current||!validSlip||!active||!transaction.ready||!!transaction.pending} onClick={()=>void submit()}>{labels[mode]}</Button>
    </Card></aside></div>
  </>;
}
