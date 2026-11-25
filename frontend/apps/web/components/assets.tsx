'use client';
import {useMemo, useState} from 'react';
import {LayoutGrid, List, Search} from 'lucide-react';
import {Card, Empty, Metric} from '@indexfi/ui';
import {referenceAssets, referenceCategories} from '@/lib/catalog';
import {useNow, usePriceState} from '@/lib/prices';
import {ageLabel, formatPrice, type Asset} from '@/domain/model';
import type {AssetPrice} from '@/lib/api';
import {AssetIcon} from './asset-icon';
import {AssetChart, HISTORY_WINDOWS} from './asset-chart';
import {ApiStatusBadge, apiStatusText} from './api-status';

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
type Sort = 'symbol' | 'price' | 'updated';

function PriceCell({price}: {price?: AssetPrice}) {
  return <span title={price ? `${price.price} USD (exact)` : 'No price received yet'}>{formatPrice(price?.price)}</span>;
}

export function Assets() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<Sort>('symbol');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [selectedId, setSelectedId] = useState(referenceAssets.find(a => a.symbol === 'BTCB')?.id ?? referenceAssets[0].id);
  const [windowMs, setWindowMs] = useState<number>(HISTORY_WINDOWS[0][1]);
  const state = usePriceState();
  const now = useNow();
  const selected = referenceAssets.find(a => a.id === selectedId) ?? referenceAssets[0];
  const status = apiStatusText(state);
  const priced = referenceAssets.filter(a => state.byAsset.has(a.id)).length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = referenceAssets.filter(
      asset =>
        (category === 'All' || asset.category === category) &&
        (!term || `${asset.symbol} ${asset.name} ${asset.address} ${asset.feedId} ${asset.feedName}`.toLowerCase().includes(term)),
    );
    const price = (a: Asset) => {
      const value = state.byAsset.get(a.id);
      return value ? Number(value.price) : -Infinity;
    };
    const updated = (a: Asset) => state.byAsset.get(a.id)?.sourceTimestamp ?? -Infinity;
    return [...rows].sort((a, b) =>
      sort === 'price' ? price(b) - price(a) : sort === 'updated' ? updated(b) - updated(a) : a.symbol.localeCompare(b.symbol, 'en'),
    );
  }, [search, category, sort, state.byAsset]);

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Catalog / Reference assets</div>
        <h1>Assets</h1>
        <p>
          BNB Chain (56) tokens with the Atlas feed verified by the IndexFi price server. USD reference prices are polled from the IndexFi API once per
          second; the browser never contacts Atlas. These are price references, not verified testnet collateral.
        </p>
      </div>
      <section className="summary-grid">
        <Card><Metric label="Reference assets" value={referenceAssets.length} detail="verified selection, public channel" /></Card>
        <Card><Metric label="Prices received" value={`${priced} / ${referenceAssets.length}`} detail="from the latest snapshot" /></Card>
        <Card>
          <Metric
            label="Last server sample"
            value={state.snapshot ? new Date(state.snapshot.snapshotAtMs).toLocaleTimeString() : '—'}
            detail="server sample time, not oracle update time"
          />
        </Card>
        <Card><Metric label="Price API" value={<ApiStatusBadge state={state} />} detail={status.detail ?? undefined} /></Card>
      </section>

      <AssetChart asset={selected} windowMs={windowMs} onWindow={setWindowMs} title={`${selected.symbol} · ${selected.name}`} />

      <section className="section-heading">
        <div className="tabs category-tabs">
          {['All', ...referenceCategories].map(name => (
            <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
          ))}
        </div>
        <label className="search">
          <Search size={17} />
          <input aria-label="Search assets" placeholder="Symbol, name, address or feed" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </section>
      <div className="toolbar">
        <span className="muted">{visible.length} assets · select one to chart it</span>
        <div className="toolbar-actions">
          <label className="sort">
            <select aria-label="Sort assets" value={sort} onChange={event => setSort(event.target.value as Sort)}>
              <option value="symbol">Symbol</option>
              <option value="price">Price</option>
              <option value="updated">Most recently updated</option>
            </select>
          </label>
          <div className="view-toggle">
            <button aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={18} /></button>
            <button aria-label="Card view" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={17} /></button>
          </div>
        </div>
      </div>

      {!visible.length ? (
        <Empty>No matching assets.</Empty>
      ) : view === 'table' ? (
        <Card className="market-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Asset</th><th>Category</th><th>Contract</th><th>Atlas feed</th><th>Reference price</th><th>Source time</th></tr>
              </thead>
              <tbody>
                {visible.map(asset => {
                  const price = state.byAsset.get(asset.id);
                  return (
                    <tr key={asset.id} aria-selected={asset.id === selected.id} className={asset.id === selected.id ? 'row--selected' : undefined}>
                      <td>
                        <button className="portfolio-name row-button" onClick={() => setSelectedId(asset.id)} aria-label={`Chart ${asset.symbol}`}>
                          <AssetIcon asset={asset} />
                          <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
                        </button>
                      </td>
                      <td>{asset.category}</td>
                      <td title={asset.address}><code>{shortAddress(asset.address)}</code></td>
                      <td><span className="portfolio-name"><span><strong>#{asset.feedId}</strong><small>{asset.feedName}</small></span></span></td>
                      <td><PriceCell price={price} /></td>
                      <td title={price ? new Date(price.sourceTimestamp * 1000).toISOString() : undefined}>{price ? ageLabel(price.sourceTimestamp, now) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="portfolio-grid">
          {visible.map(asset => {
            const price = state.byAsset.get(asset.id);
            return (
              <Card key={asset.id} className={`portfolio-card${asset.id === selected.id ? ' card--selected' : ''}`}>
                <div className="card-heading">
                  <span className="portfolio-name"><AssetIcon asset={asset} /><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span></span>
                  <small className="muted">#{asset.feedId}</small>
                </div>
                <div className="portfolio-card__metrics">
                  <Metric label="Reference price" value={<PriceCell price={price} />} />
                  <Metric label="Source time" value={price ? ageLabel(price.sourceTimestamp, now) : '—'} />
                </div>
                <button className="text-link text-button" onClick={() => setSelectedId(asset.id)}>Chart {asset.symbol}</button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
