'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useMemo, useState} from 'react';
import {ArrowUpRight, Plus, Search, LayoutGrid, List} from 'lucide-react';
import {Badge, Card, Metric, Empty} from '@indexfi/ui';
import {portfolios} from '@/domain/fixtures';
import {categories, compact, usd, percent, FUNDING_TOKEN, type Portfolio} from '@/domain/model';
import {AssetIcon} from './asset-icon';

function Tokens({p}: {p: Portfolio}) {
  return (
    <div className="token-stack" title={p.allocations.map(a => `${a.asset.symbol} ${a.weight}%`).join(', ')}>
      {p.allocations.slice(0, 4).map(a => <AssetIcon key={a.asset.id} asset={a.asset} />)}
      {p.allocations.length > 4 && <small>+{p.allocations.length - 4}</small>}
    </div>
  );
}

function Featured({p}: {p?: Portfolio}) {
  if (!p)
    return (
      <div className="hero__aside">
        <div className="eyebrow">The portfolio standard</div>
        <h2>Transparent composition.<br />Open markets.</h2>
        <p>Pre-funded collateral · Buy and hold · On-chain trading</p>
      </div>
    );
  return (
    <div className="hero__aside">
      <div className="hero-preview__head">
        <div className="eyebrow">Featured basket</div>
        <Badge tone="warn">Fixture</Badge>
      </div>
      <div className="hero-preview__title">
        <span className="token-mark">{p.symbol.slice(0, 2)}</span>
        <div><h2>{p.name}</h2><small>{p.symbol} · {p.category} · {p.allocations.length} assets</small></div>
      </div>
      <div className="hero-preview__metrics">
        <Metric label="NAV / share" value={usd(p.reference, 4)} />
        <Metric label="30d" value={<span className={(p.return30d ?? 0) < 0 ? 'negative' : 'positive'}>{percent(p.return30d)}</span>} />
        <Metric label="AUM" value={compact(p.aum)} />
      </div>
      <div>
        <div className="allocation-bar">{p.allocations.map(a => <span key={a.asset.id} style={{width: `${a.weight}%`, background: a.asset.color}} />)}</div>
        <div className="hero-preview__rows">
          {p.allocations.slice(0, 4).map(a => (
            <div className="hero-preview__row" key={a.asset.id}>
              <AssetIcon asset={a.asset} />
              <span>{a.asset.symbol} <span className="muted">· {a.asset.name}</span></span>
              <span>{a.weight.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="hero-preview__foot">
        <span>Illustrative fixture values</span>
        <Link className="text-link" href={`/portfolio/${p.id}`}>View portfolio <ArrowUpRight size={15} /></Link>
      </div>
    </div>
  );
}

export function Explore() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState('aum');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [filter, setFilter] = useState('all');
  const router = useRouter();
  const all = portfolios;
  const visible = all
    .filter(
      p =>
        (category === 'All' || p.category === category) &&
        (filter === 'all' || p.phase === filter) &&
        `${p.name} ${p.symbol} ${p.creator ?? ''} ${p.allocations.map(a => a.asset.symbol).join(' ')}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'recent'
        ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : sort === 'volume'
          ? (b.volume ?? -1) - (a.volume ?? -1)
          : sort === 'return'
            ? (b.return30d ?? -Infinity) - (a.return30d ?? -Infinity)
            : (b.aum ?? -1) - (a.aum ?? -1),
    );
  const featured = useMemo(() => [...all].sort((a, b) => (b.aum ?? -1) - (a.aum ?? -1))[0], [all]);
  const sum = (k: 'aum' | 'volume' | 'liquidity') => (all.length && all.every(p => p[k] != null) ? all.reduce((s, p) => s + (p[k] ?? 0), 0) : null);
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">01 / Portfolio markets</div>
          <h1>Invest in ideas.<br /><span>Own the basket.</span></h1>
          <p>Create and trade fixed-supply portfolios of existing assets. One portfolio, one token, {FUNDING_TOKEN} settlement.</p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/create"><Plus size={16} /> Create portfolio</Link>
            <a className="button button--secondary" href="#discover">Explore markets</a>
          </div>
        </div>
        <Featured p={featured} />
      </section>
      <section className="summary-grid">
        <Card><Metric label="Listed portfolios" value={all.length} detail="fixtures" /></Card>
        <Card><Metric label="Assets under management" value={compact(sum('aum'))} detail="fixture" /></Card>
        <Card><Metric label="24h trading volume" value={compact(sum('volume'))} detail="fixture" /></Card>
        <Card><Metric label="Trading liquidity" value={compact(sum('liquidity'))} detail="fixture" /></Card>
      </section>
      <section className="section-heading" id="discover">
        <div>
          <div className="eyebrow">02 / Discover</div>
          <h2>Explore portfolios</h2>
          <p>Fixture portfolios with real registry constituents. NAV, price, return, AUM, volume and liquidity are illustrative until contracts are integrated.</p>
        </div>
        <label className="search">
          <Search size={17} />
          <input aria-label="Search portfolios" placeholder="Search name, asset or creator" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
      </section>
      <div className="toolbar">
        <div className="tabs category-tabs">
          {['All', ...categories].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}
        </div>
        <div className="toolbar-actions">
          <label className="sort">
            <select aria-label="Launch status" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">All phases</option>
              <option value="launch">OpenFour</option>
              <option value="graduated">Graduated</option>
            </select>
          </label>
          <label className="sort">
            <select aria-label="Sort portfolios" value={sort} onChange={e => setSort(e.target.value)}>
              <option value="aum">AUM</option>
              <option value="volume">Volume</option>
              <option value="recent">Recently launched</option>
              <option value="return">30d return</option>
            </select>
          </label>
          <div className="view-toggle">
            <button aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={18} /></button>
            <button aria-label="Card view" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={17} /></button>
          </div>
        </div>
      </div>
      {!visible.length ? (
        <Empty>No matching portfolios.</Empty>
      ) : view === 'table' ? (
        <Card className="market-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Portfolio</th><th>Assets</th><th>NAV / share</th><th>Market price</th><th>30d</th><th>AUM</th><th>24h volume</th><th>Liquidity</th><th>Venue</th><th /></tr>
              </thead>
              <tbody>
                {visible.map(p => (
                  <tr key={p.id} className="row-link" onClick={event => { if (!(event.target as HTMLElement).closest('a')) router.push(`/portfolio/${p.id}`); }}>
                    <td>
                      <Link href={`/portfolio/${p.id}`} className="portfolio-name">
                        <span className="token-mark">{p.symbol.slice(0, 2)}</span>
                        <span><strong>{p.name}</strong><small>{p.symbol} · {p.category} · fixture</small></span>
                      </Link>
                    </td>
                    <td><Tokens p={p} /></td>
                    <td>{usd(p.reference, 4)}</td>
                    <td>{usd(p.marketPrice, 4)}</td>
                    <td className={(p.return30d ?? 0) < 0 ? 'negative' : 'positive'}>{percent(p.return30d)}</td>
                    <td>{compact(p.aum)}</td>
                    <td>{compact(p.volume)}</td>
                    <td>{compact(p.liquidity)}</td>
                    <td><Badge tone={p.phase === 'graduated' ? 'good' : 'neutral'}>{p.venue}</Badge></td>
                    <td><Link aria-label={`View ${p.name}`} href={`/portfolio/${p.id}`}><ArrowUpRight size={18} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="portfolio-grid">
          {visible.map(p => (
            <Card key={p.id} className="portfolio-card">
              <div className="card-heading"><Tokens p={p} /><Badge tone="warn">Fixture</Badge></div>
              <h3>{p.name}</h3>
              <p>{p.description}</p>
              <div className="portfolio-card__metrics">
                <Metric label="NAV" value={usd(p.reference, 4)} />
                <Metric label="AUM" value={compact(p.aum)} />
              </div>
              <Link className="text-link" href={`/portfolio/${p.id}`}>View portfolio <ArrowUpRight size={16} /></Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
