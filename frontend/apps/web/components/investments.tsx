'use client';
import Link from 'next/link';
import {useAccount} from 'wagmi';
import {Badge, Card, Empty, Metric} from '@indexfi/ui';
import {FUNDING_TOKEN} from '@/domain/model';

/**
 * Wallet-backed holdings arrive with contract integration (Phase III). No simulated
 * balances, positions or transactions are shown.
 */
export function Investments() {
  const account = useAccount();
  const connected = account.isConnected && account.address;
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Investor workspace</div>
        <h1>My investments</h1>
        <p>Positions, created portfolios and trades are read from your wallet once the verified contract adapter is integrated.</p>
      </div>
      <div className="summary-grid">
        <Card><Metric label="Wallet" value={connected ? `${account.address!.slice(0, 6)}…${account.address!.slice(-4)}` : 'Not connected'} detail={connected ? `chain ${account.chainId}` : 'use Connect wallet above'} /></Card>
        <Card><Metric label={`${FUNDING_TOKEN} balance`} value="—" detail="not read in this phase" /></Card>
        <Card><Metric label="Portfolio holdings" value="—" detail="requires contract integration" /></Card>
      </div>
      <Card>
        <div className="card-heading"><h2>Positions</h2><Badge>Not connected</Badge></div>
        <Empty>On-chain positions are not available yet. No simulated balances are shown. <Link href="/">Explore portfolios</Link></Empty>
      </Card>
      <Card className="history-card">
        <div className="card-heading"><h2>Created portfolios</h2><Badge>Not connected</Badge></div>
        <Empty>Portfolios you launch will appear here after contract integration.</Empty>
      </Card>
      <Card className="history-card">
        <div className="card-heading"><h2>Trade history</h2><Badge>Not connected</Badge></div>
        <Empty>No trades are recorded in this phase.</Empty>
      </Card>
    </>
  );
}
