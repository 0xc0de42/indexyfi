'use client';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import {Badge, Card, Empty} from '@indexfi/ui';
import type {Address} from 'viem';
import {useDeployment,useDirectory,useVault} from '@/lib/use-vaults';
import {units,type Deployment} from '@/lib/vaults';

function VaultRow({deployment,address}:{deployment:Deployment;address:Address}){
  const vault=useVault(deployment,address);
  if(!vault.data)return null;
  const v=vault.data;
  return <tr data-testid="onchain-vault-row"><td><Link href={`/portfolio/${address}`} className="portfolio-name"><span className="token-mark">{v.symbol.slice(0,2)}</span><span><strong>{v.name}</strong><small>{v.symbol} · on-chain</small></span></Link></td><td>{v.holdings.map(x=>x.symbol).join(', ')}</td><td>{v.holdings.length}</td><td>{units(v.supply,18)}</td><td><Badge tone={v.closed?'bad':'good'}>{v.closed?'Closed':'Open'}</Badge></td><td><Link aria-label={`View ${v.name}`} href={`/portfolio/${address}`}><ArrowUpRight size={18}/></Link></td></tr>;
}

export function OnchainDirectory(){
  const deployment=useDeployment();
  const directory=useDirectory(deployment.data);
  if(deployment.isLoading||directory.isLoading)return <Card><p className="muted">Loading public vaults…</p></Card>;
  if(deployment.isError||directory.isError||!deployment.data)return <Card><Empty>Contract directory unavailable on the active network.</Empty></Card>;
  if(!directory.data?.length)return <Card><Empty>No public vaults have launched yet. <Link href="/create">Create the first vault</Link></Empty></Card>;
  return <Card className="market-table"><div className="card-heading"><h3>Live public vaults</h3><Badge tone="good">{deployment.data.fixture?'Local fixture':'On-chain'}</Badge></div><div className="table-scroll"><table><thead><tr><th>Vault</th><th>Assets</th><th>Constituents</th><th>Backed supply</th><th>Status</th><th/></tr></thead><tbody>{directory.data.map(address=><VaultRow key={address} deployment={deployment.data!} address={address}/>)}</tbody></table></div></Card>;
}
