'use client';
import Link from 'next/link';
import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft} from 'lucide-react';
import {Badge, Button, Card, Empty, Metric} from '@indexfi/ui';
import {formatUnits, type Address} from 'viem';
import {useAccount} from 'wagmi';
import {usePriceState} from '@/lib/prices';
import {referenceAssetById} from '@/lib/catalog';
import {exactAmount, units, vaultAbi} from '@/lib/vaults';
import {useDeployment, useVault, useVaultTransaction} from '@/lib/use-vaults';

export function OnchainVault({address}:{address:Address}) {
  const deployment=useDeployment();
  const account=useAccount();
  const vault=useVault(deployment.data,address);
  const transaction=useVaultTransaction(deployment.data);
  const prices=usePriceState();
  const [mode,setMode]=useState<'deposit'|'redeem'>('deposit');
  const [amount,setAmount]=useState('100');
  const [quote,setQuote]=useState<{shares:bigint;outputs:readonly bigint[]}|{gross:bigint;fee:bigint;net:bigint}|null>(null);
  const [quoteError,setQuoteError]=useState('');

  useEffect(()=>{
    let active=true;
    async function preview(){
      setQuote(null);setQuoteError('');
      if(!deployment.client||!deployment.data||!vault.data)return;
      const value=exactAmount(amount,mode==='deposit'?deployment.data.settlementDecimals:18);
      if(!value)return;
      try {
        if(mode==='deposit'){
          const [shares,outputs]=await deployment.client.readContract({address,abi:vaultAbi,functionName:'previewDeposit',args:[value]});
          if(active)setQuote({shares,outputs});
        } else {
          if(!account.address){setQuoteError('Connect your wallet to quote a redemption.');return;}
          const [gross,fee,net]=await deployment.client.readContract({address,abi:vaultAbi,functionName:'previewRedeem',args:[account.address,value]});
          if(active)setQuote({gross,fee,net});
        }
      }catch(err){if(active)setQuoteError(err instanceof Error?err.message.split('\n')[0]:'Quote failed');}
    }
    void preview();return()=>{active=false;};
  },[amount,mode,address,deployment.client,deployment.data,vault.data,account.address]);

  const metrics=useMemo(()=>{
    if(!vault.data)return {aum:null,nav:null};
    let aum=0;
    for(const holding of vault.data.holdings){
      const price=prices.byAsset.get(holding.referenceAssetId)?.price;
      if(!price)return {aum:null,nav:null};
      aum+=Number(formatUnits(holding.balance,holding.decimals))*Number(price);
    }
    return {aum,nav:vault.data.supply?aum/Number(formatUnits(vault.data.supply,18)):null};
  },[vault.data,prices.byAsset]);

  async function submit(){
    if(!quote||!vault.data)return;
    const value=exactAmount(amount,mode==='deposit'?(deployment.data?.settlementDecimals??6):18);
    if(!value)return;
    const action=mode==='deposit'&&'shares' in quote
      ? {kind:'deposit' as const,vault:address,amount:value,shares:quote.shares,outputs:quote.outputs}
      : mode==='redeem'&&'net' in quote
        ? {kind:'redeem' as const,vault:address,amount:value,net:quote.net}
        : undefined;
    if(await transaction.submit(action!,100))await vault.refetch();
  }

  if(deployment.isLoading||vault.isLoading)return <div className="page-heading"><h1>Loading vault…</h1></div>;
  if(deployment.error||vault.error||!deployment.data||!vault.data)return <Empty>Vault unavailable on the active deployment. <Link href="/">Return to Explore</Link></Empty>;
  const v=vault.data;
  return <>
    <Link className="back-link" href="/"><ArrowLeft size={15}/> All vaults</Link>
    <div className="detail-heading"><div className="detail-title"><span className="token-mark token-mark--large">{v.symbol.slice(0,2)}</span><div><div className="eyebrow">Public basket vault</div><h1>{v.name}</h1><p>{v.symbol} · {address}</p></div></div><Badge tone={v.closed?'bad':'good'}>{v.closed?'Closed':'Open'}</Badge></div>
    <div className="detail-grid"><div className="stack">
      <Card><div className="card-heading"><h2>Vault state</h2><Badge>On-chain</Badge></div><div className="price-metrics"><Metric label="Indicative NAV / share" value={metrics.nav==null?'—':`$${metrics.nav.toFixed(4)}`} detail="Atlas display prices"/><Metric label="Indicative AUM" value={metrics.aum==null?'—':`$${metrics.aum.toFixed(2)}`} detail={`block ${v.blockNumber}`}/><Metric label="Share supply" value={units(v.supply,18)}/></div></Card>
      <Card><div className="card-heading"><h2>Actual holdings</h2><Badge>Contract balances</Badge></div><div className="table-scroll"><table><thead><tr><th>Asset</th><th>Target</th><th>Balance</th><th>Atlas price</th></tr></thead><tbody>{v.holdings.map(h=><tr key={h.address}><td>{referenceAssetById(h.referenceAssetId)?.name??h.symbol}</td><td>{Number(h.weightBps)/100}%</td><td>{units(h.balance,h.decimals)} {h.symbol}</td><td>{prices.byAsset.get(h.referenceAssetId)?.price??'Unavailable'}</td></tr>)}</tbody></table></div></Card>
      <Card><h2>Transparency</h2><dl className="key-values"><div><dt>Creator</dt><dd className="address">{v.creator}</dd></div><div><dt>Your shares</dt><dd data-testid="wallet-shares">{units(v.shares,18)}</dd></div><div><dt>Your remaining basis</dt><dd>{units(v.basis,deployment.data.settlementDecimals)} USDT</dd></div><div><dt>Creator performance fee</dt><dd>10% of positive realized profit on redemption</dd></div></dl></Card>
    </div><aside className="stack trade-column"><Card className="trade-panel"><div className="card-heading"><h2>{mode==='deposit'?'Deposit':'Redeem'}</h2><Badge tone={transaction.ready?'good':'warn'}>{transaction.ready?'Wallet ready':'Connect wallet'}</Badge></div><div className="segmented"><button aria-pressed={mode==='deposit'} onClick={()=>setMode('deposit')}>Deposit</button><button aria-pressed={mode==='redeem'} onClick={()=>setMode('redeem')}>Redeem</button></div><label className="field">{mode==='deposit'?'USDT amount':'Shares'}<input data-testid="vault-amount" value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/></label>{quote&&<dl className="key-values">{mode==='deposit'&&'shares' in quote?<div><dt>Expected shares</dt><dd>{units(quote.shares,18)}</dd></div>:mode==='redeem'&&'net' in quote?<><div><dt>Gross proceeds</dt><dd>{units(quote.gross,deployment.data.settlementDecimals)} USDT</dd></div><div><dt>Creator fee</dt><dd>{units(quote.fee,deployment.data.settlementDecimals)} USDT</dd></div><div><dt>Net proceeds</dt><dd data-testid="net-quote">{units(quote.net,deployment.data.settlementDecimals)} USDT</dd></div></>:null}</dl>}{(quoteError||transaction.error)&&<div role="alert" className="notice notice--bad">{quoteError||transaction.error}</div>}{transaction.pending&&<div role="status" className="notice notice--neutral">{transaction.pending}</div>}<Button data-testid="vault-submit" className="full-width" disabled={!quote||!transaction.ready||!!transaction.pending} onClick={()=>void submit()}>{mode==='deposit'?'Deposit USDT':'Redeem shares'}</Button></Card></aside></div>
  </>;
}
