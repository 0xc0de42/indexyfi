'use client';
import Link from 'next/link';
import {useAccount} from 'wagmi';
import {Badge, Card, Empty, Metric} from '@indexfi/ui';
import {FUNDING_TOKEN} from '@/domain/model';
import {Wallet} from './wallet';

/**
 * Wallet-backed holdings arrive with contract integration (Phase III). No simulated
 * balances, positions or transactions are shown.
 */
export function Investments() {
  const account = useAccount();
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
            Positions, portfolios you created and trades will be read from your wallet on BSC testnet once the contract adapter is integrated (Phase III).
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
        <p>Positions, created portfolios and trades are read from your wallet once the verified contract adapter is integrated.</p>
      </div>
      <div className="summary-grid">
        <Card><Metric label="Wallet" value={`${account.address!.slice(0, 6)}…${account.address!.slice(-4)}`} detail={`chain ${account.chainId}`} /></Card>
        <Card><Metric label={`${FUNDING_TOKEN} balance`} value="—" detail="not read in this phase" /></Card>
        <Card><Metric label="Portfolio holdings" value="—" detail="requires contract integration" /></Card>
      </div>
      <Card>
        <div className="card-heading"><h2>Positions</h2><Badge>Phase III</Badge></div>
        <Empty>On-chain positions are not available yet. <Link href="/">Explore portfolios</Link></Empty>
      </Card>
      <Card className="history-card">
        <div className="card-heading"><h2>Created portfolios and trades</h2><Badge>Phase III</Badge></div>
        <Empty>Portfolios you launch and your trades will appear here after contract integration.</Empty>
      </Card>
    </>
  );
}
