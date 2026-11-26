'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useMemo, useState} from 'react';
import {ArrowUpRight, Plus, Search, LayoutGrid, List} from 'lucide-react';
import {Badge, Card, Metric, Empty} from '@indexfi/ui';
import {compact, usd, percent, FUNDING_TOKEN} from '@/domain/model';
import {referenceAssetById} from '@/lib/catalog';
import {usePriceState} from '@/lib/prices';
import {useDeployment, useVaults} from '@/lib/use-vaults';
import {total, valuation, type Valuation} from '@/lib/valuation';
import type {Deployment, VaultSnapshot} from '@/lib/vaults';
import {AssetIcon} from './asset-icon';

type Row = {v: VaultSnapshot; val: Valuation};

function Tokens({v}: {v: VaultSnapshot}) {
  const assets = v.holdings.map(h => referenceAssetById(h.referenceAssetId)).filter(a => a !== undefined);
  return (
    <div className="token-stack" title={v.holdings.map(h => `${h.symbol} ${Number(h.weightBps) / 100}%`).join(', ')}>
      {assets.slice(0, 4).map(a => <AssetIcon key={a.id} asset={a} />)}
      {assets.length > 4 && <small>+{assets.length - 4}</small>}
    </div>
  );
}

function venue(d: Deployment) {
  return d.fixture ? 'Local fixture' : d.testAssets ? 'BSC Testnet · test assets' : 'On-chain';
}

function Featured({row, d}: {row?: Row; d?: Deployment}) {
  if (!row || !d)
    return (
      <div className="hero__aside">
        <div className="eyebrow">The portfolio standard</div>
        <h2>Transparent composition.<br />Open markets.</h2>
        <p>Collateral-backed · Primary deposits and redemptions · PancakeSwap trading</p>
      </div>
    );
  const {v, val} = row;
  const byValue = [...val.holdings].sort((a, b) => (b.valuePct ?? b.targetPct) - (a.valuePct ?? a.targetPct));
  return (
    <div className="hero__aside">
      <div className="hero-preview__head">
        <div className="eyebrow">Latest basket</div>
        <Badge tone="good">{venue(d)}</Badge>
      </div>
      <div className="hero-preview__title">
        <span className="token-mark">{v.symbol.slice(0, 2)}</span>
        <div><h2>{v.name}</h2><small>{v.symbol} · {v.holdings.length} assets</small></div>
      </div>
      <div className="hero-preview__metrics">
        <Metric label="NAV / share" value={usd(val.nav, 4)} />
        <Metric label="Market price" value={usd(val.market, 4)} />
        <Metric label="AUM" value={compact(val.aum)} />
      </div>
      <div>
        <div className="allocation-bar">
          {byValue.map(h => <span key={h.referenceAssetId} style={{width: `${h.valuePct ?? h.targetPct}%`, background: referenceAssetById(h.referenceAssetId)?.color}} />)}
        </div>
        <div className="hero-preview__rows">
          {byValue.slice(0, 4).map(h => {
            const asset = referenceAssetById(h.referenceAssetId);
            return (
              <div className="hero-preview__row" key={h.referenceAssetId}>
                {asset && <AssetIcon asset={asset} />}
                <span>{h.symbol} <span className="muted">· {asset?.name ?? h.symbol}</span></span>
                <span>{(h.valuePct ?? h.targetPct).toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="hero-preview__foot">
        <span>On-chain holdings · Atlas prices</span>
        <Link className="text-link" href={`/portfolio/${v.address}`}>View basket <ArrowUpRight size={15} /></Link>
      </div>
    </div>
  );
}

export function Explore() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'aum' | 'recent' | 'name' | 'premium'>('aum');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const router = useRouter();
  const deployment = useDeployment();
  const {vaults, isLoading, isError} = useVaults(deployment.data);
  const prices = usePriceState();
  const rows: Row[] = useMemo(
    () => (deployment.data ? vaults.map(v => ({v, val: valuation(v, prices.byAsset, deployment.data!.settlementDecimals)})) : []),
    [vaults, prices.byAsset, deployment.data],
  );
  const visible = rows
    .filter(({v}) => `${v.name} ${v.symbol} ${v.creator} ${v.holdings.map(h => h.symbol).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === 'recent' ? 0 : sort === 'name' ? a.v.name.localeCompare(b.v.name)
        : sort === 'premium' ? (b.val.premiumPct ?? -Infinity) - (a.val.premiumPct ?? -Infinity)
          : (b.val.aum ?? -1) - (a.val.aum ?? -1));
  const assetsHeld = new Set(rows.flatMap(r => r.v.holdings.map(h => h.referenceAssetId))).size;
  const d = deployment.data;
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">01 / Portfolio markets</div>
          <h1>Invest in ideas.<br /><span>Own the basket.</span></h1>
          <p>Collateral-backed portfolio tokens: deposit or redeem {FUNDING_TOKEN} at NAV, or trade the same token on PancakeSwap.</p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/create"><Plus size={16} /> Create portfolio</Link>
            <a className="button button--secondary" href="#discover">Explore markets</a>
          </div>
        </div>
        <Featured row={rows[0]} d={d} />
      </section>
      <section className="summary-grid">
        <Card><Metric label="Listed portfolios" value={d ? rows.length : '—'} detail={d ? venue(d) : 'no deployment'} /></Card>
        <Card><Metric label="Assets under management" value={compact(total(rows.map(r => r.val.aum)))} detail="on-chain holdings × Atlas prices" /></Card>
        <Card><Metric label="Trading liquidity" value={compact(total(rows.map(r => r.val.liquidity)))} detail="PancakeSwap pools" /></Card>
        <Card><Metric label="Assets held" value={assetsHeld} detail="distinct constituents" /></Card>
      </section>
      <section className="section-heading" id="discover">
        <div>
          <div className="eyebrow">02 / Discover</div>
          <h2>Explore portfolios</h2>
          <p>Every basket launched through the IndexFi preset, read from chain. NAV and AUM use on-chain holdings and the latest Atlas prices.</p>
        </div>
        <label className="search">
          <Search size={17} />
          <input aria-label="Search portfolios" placeholder="Search name, asset or creator" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
      </section>
      <div className="toolbar">
        <div />
        <div className="toolbar-actions">
          <label className="sort">
            <select aria-label="Sort portfolios" value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
              <option value="aum">AUM</option>
              <option value="recent">Recently launched</option>
              <option value="premium">Premium to NAV</option>
              <option value="name">Name</option>
            </select>
          </label>
          <div className="view-toggle">
            <button aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={18} /></button>
            <button aria-label="Card view" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={17} /></button>
          </div>
        </div>
      </div>
      {deployment.isError || isError ? (
        <Card><Empty>Contract directory unavailable on the active network.</Empty></Card>
      ) : !d || (isLoading && !rows.length) ? (
        <Card><p className="muted">Loading portfolios…</p></Card>
      ) : !rows.length ? (
        <Card><Empty>No portfolios have launched yet. <Link href="/create">Create the first one</Link></Empty></Card>
      ) : !visible.length ? (
        <Empty>No matching portfolios.</Empty>
      ) : view === 'table' ? (
        <Card className="market-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Portfolio</th><th>Assets</th><th>NAV / share</th><th>Market price</th><th>Premium</th><th>AUM</th><th>Liquidity</th><th>Venue</th><th /></tr>
              </thead>
              <tbody>
                {visible.map(({v, val}) => (
                  <tr key={v.address} data-testid="onchain-vault-row" className="row-link" onClick={event => { if (!(event.target as HTMLElement).closest('a')) router.push(`/portfolio/${v.address}`); }}>
                    <td>
                      <Link href={`/portfolio/${v.address}`} className="portfolio-name">
                        <span className="token-mark">{v.symbol.slice(0, 2)}</span>
                        <span><strong>{v.name}</strong><small>{v.symbol} · {v.holdings.length} assets</small></span>
                      </Link>
                    </td>
                    <td><Tokens v={v} /></td>
                    <td>{usd(val.nav, 4)}</td>
                    <td>{usd(val.market, 4)}</td>
                    <td className={(val.premiumPct ?? 0) < 0 ? 'negative' : 'positive'}>{percent(val.premiumPct)}</td>
                    <td>{compact(val.aum)}</td>
                    <td>{compact(val.liquidity)}</td>
                    <td><Badge tone={v.phase === 3 ? 'good' : 'neutral'}>{v.closed ? 'Closed' : v.phase === 3 ? 'PancakeSwap' : 'Launching'}</Badge></td>
                    <td><Link aria-label={`View ${v.name}`} href={`/portfolio/${v.address}`}><ArrowUpRight size={18} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="portfolio-grid">
          {visible.map(({v, val}) => (
            <Card key={v.address} className="portfolio-card">
              <div className="card-heading"><Tokens v={v} /><Badge tone="good">{v.symbol}</Badge></div>
              <h3>{v.name}</h3>
              <p className="muted">{v.holdings.map(h => h.symbol).join(' · ')}</p>
              <div className="portfolio-card__metrics">
                <Metric label="NAV" value={usd(val.nav, 4)} />
                <Metric label="AUM" value={compact(val.aum)} />
              </div>
              <Link className="text-link" href={`/portfolio/${v.address}`}>View basket <ArrowUpRight size={16} /></Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
