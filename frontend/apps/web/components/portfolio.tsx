'use client';
import Link from 'next/link';
import {useState} from 'react';
import {ArrowLeft, ArrowDown} from 'lucide-react';
import {Badge, Button, Card, Metric, Empty} from '@indexfi/ui';
import {portfolioById} from '@/domain/fixtures';
import {usd, compact, percent, FUNDING_TOKEN, type Portfolio, type Side} from '@/domain/model';
import {Allocation} from './charts';
import {AssetChart, HISTORY_WINDOWS} from './asset-chart';

function TradePanel({p}: {p: Portfolio}) {
  const [side, setSide] = useState<Side>('buy');
  return (
    <Card className="trade-panel">
      <div className="card-heading"><h2>Trade {p.symbol}</h2><Badge>Unavailable</Badge></div>
      <div className="segmented">
        {(['buy', 'sell'] as const).map(s => (
          <button key={s} aria-pressed={side === s} onClick={() => setSide(s)}>{s === 'buy' ? 'Buy' : 'Sell'}</button>
        ))}
      </div>
      <form onSubmit={e => e.preventDefault()}>
        <div className="swap-input">
          <label className="field">You pay <input type="number" placeholder="0.00" disabled /></label>
          <strong>{side === 'buy' ? FUNDING_TOKEN : p.symbol}</strong>
        </div>
        <div className="swap-arrow"><ArrowDown size={18} /></div>
        <div className="trade-result"><span>You receive</span><strong>—</strong></div>
        <dl className="key-values">
          <div><dt>Market</dt><dd>{p.venue}</dd></div>
          <div><dt>Execution quote</dt><dd>Requires contract integration</dd></div>
          <div><dt>Creator fee</dt><dd>Contract configuration pending</dd></div>
        </dl>
        <Button type="submit" className="full-width" disabled>Execution adapter pending</Button>
      </form>
      <p className="fine-print">Live quotes, wallet approvals and atomic execution are not connected in this phase. Selling is not direct collateral redemption.</p>
    </Card>
  );
}

function PortfolioContent({p}: {p: Portfolio}) {
  const [assetId, setAssetId] = useState(p.allocations[0].asset.id);
  const [windowMs, setWindowMs] = useState<number>(HISTORY_WINDOWS[0][1]);
  const constituents = p.allocations.map(a => a.asset);
  const selected = constituents.find(a => a.id === assetId) ?? constituents[0];
  const premium = p.reference && p.marketPrice ? (p.marketPrice / p.reference - 1) * 100 : null;
  return (
    <>
      <Link className="back-link" href="/"><ArrowLeft size={15} /> All portfolios</Link>
      <div className="detail-heading">
        <div className="detail-title">
          <span className="token-mark token-mark--large">{p.symbol.slice(0, 2)}</span>
          <div>
            <div className="eyebrow">{p.category} / Fixed basket</div>
            <h1>{p.name}</h1>
            <p>{p.symbol} · {p.description}</p>
          </div>
        </div>
        <Badge tone={p.paused ? 'bad' : 'warn'}>{p.paused ? 'Paused' : `Fixture · ${p.venue}`}</Badge>
      </div>
      <div className="detail-grid">
        <div className="stack">
          <Card>
            <div className="card-heading"><h2>Portfolio performance</h2><Badge tone="warn">Fixture values</Badge></div>
            <div className="price-metrics">
              <Metric label="Market price" value={usd(p.marketPrice, 4)} detail="fixture" />
              <Metric label="NAV / share" value={usd(p.reference, 4)} detail={`fixture · premium ${percent(premium)}`} />
              <Metric label="30d return" value={percent(p.return30d)} detail="fixture" />
            </div>
            <Empty>
              Portfolio NAV history is not available yet. It requires on-chain historical holdings and share supply (Phase III); constituent prices
              below are not a substitute for it.
            </Empty>
            <div className="detail-metrics">
              <Metric label="AUM" value={compact(p.aum)} detail="fixture" />
              <Metric label="24h volume" value={compact(p.volume)} detail="fixture" />
              <Metric label="Liquidity" value={compact(p.liquidity)} detail="fixture" />
              <Metric label="Market cap" value={compact(p.supply && p.marketPrice ? p.supply * p.marketPrice : null)} detail="fixture" />
            </div>
          </Card>
          <AssetChart
            asset={selected}
            choices={constituents}
            onChoose={setAssetId}
            windowMs={windowMs}
            onWindow={setWindowMs}
            title="Constituent reference prices"
          />
          <Card>
            <div className="card-heading"><h2>Composition</h2><Badge>Buy and hold</Badge></div>
            <Allocation portfolio={p} />
            <p className="fine-print">Initial weights are fixture values; current weights need on-chain holdings. Reference prices are live from the IndexFi API (chain 56 references, not testnet collateral).</p>
          </Card>
          <Card>
            <h2>Transparency</h2>
            <dl className="key-values">
              <div><dt>Creator</dt><dd>{p.creator ?? 'Not available'}</dd></div>
              <div><dt>Share supply</dt><dd>{p.supply ? `${p.supply.toLocaleString()} (fixture)` : '—'}</dd></div>
              <div><dt>Backing</dt><dd>Not verified (fixture)</dd></div>
              <div><dt>Creator fee</dt><dd>{p.creatorFeeBps == null ? '—' : `${p.creatorFeeBps / 100}% (fixture)`}</dd></div>
            </dl>
            <details>
              <summary>Contracts and constituent metadata</summary>
              <dl className="key-values">
                <div><dt>Token</dt><dd className="address">{p.tokenAddress ?? 'Not deployed'}</dd></div>
                <div><dt>Vault</dt><dd className="address">{p.vaultAddress ?? 'Not deployed'}</dd></div>
              </dl>
              {p.allocations.map(a => (
                <p className="fine-print" key={a.asset.id}>
                  {a.asset.symbol}: chain {a.asset.chainId} reference {a.asset.address} · Atlas feed #{a.asset.feedId} ({a.asset.feedName}) · no verified testnet address
                </p>
              ))}
            </details>
            <p className="fine-print">No direct redemption or guaranteed NAV exit in this MVP.</p>
          </Card>
        </div>
        <aside className="stack trade-column">
          <TradePanel p={p} />
          <Card>
            <div className="card-heading"><h3>Graduation</h3><Badge tone="warn">Fixture</Badge></div>
            <div className="progress-track"><span style={{width: `${p.progress ?? 0}%`}} /></div>
            <dl className="key-values">
              <div><dt>Progress</dt><dd>{p.progress == null ? '—' : `${p.progress}%`}</dd></div>
              <div><dt>Current venue</dt><dd>{p.venue}</dd></div>
              <div><dt>Destination</dt><dd>PancakeSwap</dd></div>
            </dl>
            <p className="fine-print">Portfolio collateral remains separate from trading liquidity; this invariant needs contract verification.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}

export function PortfolioPage({id}: {id: string}) {
  const p = portfolioById(id);
  if (!p) return <Empty>Portfolio not found. <Link href="/">Return to Explore</Link></Empty>;
  return <PortfolioContent key={p.id} p={p} />;
}
