'use client';
import Link from 'next/link';
import {useAccount} from 'wagmi';
import {Badge, Card, Empty, Metric} from '@indexfi/ui';
import {FUNDING_TOKEN} from '@/domain/model';
import {Wallet} from './wallet';
import type {Address} from 'viem';
import {units,type Deployment} from '@/lib/vaults';
import {useDeployment,useDirectory,useVault} from '@/lib/use-vaults';

function Position({deployment,address}:{deployment:Deployment;address:Address}){
  const vault=useVault(deployment,address);
  const {address:holder}=useAccount();
  if(!vault.data|| (vault.data.shares===0n && !vault.data.pool?.lpBalance && vault.data.creator.toLowerCase()!==holder?.toLowerCase()))return null;
  return <tr><td><Link href={`/portfolio/${address}`}>{vault.data.name}</Link></td><td>{vault.data.symbol}</td><td>{units(vault.data.shares,18)}</td><td>{vault.data.pool?units(vault.data.pool.lpBalance,18):'Unavailable'}</td><td><Badge tone={vault.data.closed?'bad':'good'}>{vault.data.closed?'Closed':'Open'}</Badge></td></tr>;
}

/**
 * Wallet positions read from the active deployment: portfolio tokens, LP tokens and portfolios this wallet created.
 * No simulated balances, positions or transactions are shown.
 */
export function Investments() {
  const account = useAccount();
  const deployment=useDeployment();
  const directory=useDirectory(deployment.data);
  const connected = account.isConnected && account.address;
  if (!connected)
    return (
      <>
        <div className="page-heading">
          <div className="eyebrow">Investor workspace</div>
          <h1>My investments</h1>
        </div>
        <Card className="connect-prompt">
          <h2>Connect a wallet to see your positions</h2>
          <p className="muted">
            Positions, portfolios you created and LP holdings are read from the active deployment.
            No simulated balances are shown.
          </p>
          <div className="hero__actions">
            <Wallet />
            <Link className="button button--secondary" href="/">Explore portfolios</Link>
            <Link className="button button--ghost" href="/create">Create a portfolio</Link>
          </div>
        </Card>
      </>
    );
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Investor workspace</div>
        <h1>My investments</h1>
        <p>Portfolio and LP token balances are read from contracts for this wallet.</p>
      </div>
      <div className="summary-grid">
        <Card><Metric label="Wallet" value={`${account.address!.slice(0, 6)}…${account.address!.slice(-4)}`} detail={`chain ${account.chainId}`} /></Card>
        <Card><Metric label="Contract network" value={deployment.data?.chainId??'—'} detail={deployment.data?'manifest verified':'loading'} /></Card>
        <Card><Metric label="Public vaults" value={directory.data?.length??'—'} detail="factory directory" /></Card>
      </div>
      <Card>
        <div className="card-heading"><h2>Positions</h2><Badge tone="good">On-chain</Badge></div>
        {deployment.data&&directory.data?.length?<div className="table-scroll"><table><thead><tr><th>Vault</th><th>Token</th><th>Shares</th><th>LP tokens</th><th>Status</th></tr></thead><tbody>{directory.data.map(address=><Position key={address} deployment={deployment.data!} address={address}/>)}</tbody></table></div>:<Empty>No positions found. <Link href="/">Explore portfolios</Link></Empty>}
      </Card>
      <Card className="history-card">
        <div className="card-heading"><h2>Activity</h2><Badge>Receipt-backed</Badge></div>
        <p className="muted">Confirmed deposit and redemption receipts are reflected in the balances above. Historical event pagination is deferred for the MVP.</p>
      </Card>
    </>
  );
}
