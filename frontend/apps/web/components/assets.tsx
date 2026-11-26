'use client';
import Link from 'next/link';
import {useMemo, useRef, useState} from 'react';
import {ArrowUpDown, LayoutGrid, List, Plus, Search} from 'lucide-react';
import {Card, Empty, Metric} from '@indexfi/ui';
import {referenceAssetById, referenceAssets, referenceCategories} from '@/lib/catalog';
import {useNow, usePriceState} from '@/lib/prices';
import {createHref, portfolioHref, replaceQuery, type WindowLabel} from '@/lib/routes';
import {useDeployment, useVaults} from '@/lib/use-vaults';
import {ageLabel, formatPrice, type Asset} from '@/domain/model';
import type {AssetPrice} from '@/lib/api';
import {AssetIcon} from './asset-icon';
import {AssetChart, windowLabelOf, windowMsOf} from './asset-chart';
import {ApiStatusBadge, apiStatusText} from './api-status';

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
type Sort = 'symbol' | 'price';
const DEFAULT_ASSET = referenceAssets.find(a => a.symbol === 'BTCB')?.id ?? referenceAssets[0].id;

function PriceCell({price}: {price?: AssetPrice}) {
  return <span title={price ? `${price.price} USD (exact)` : 'No price received yet'}>{formatPrice(price?.price)}</span>;
}

function SortHeader({label, value, sort, onSort}: {label: string; value: Sort; sort: Sort; onSort: (s: Sort) => void}) {
  return (
    <th aria-sort={sort === value ? (value === 'symbol' ? 'ascending' : 'descending') : undefined}>
      <button className="th-button" onClick={() => onSort(value)}>
        {label} <ArrowUpDown size={11} aria-hidden="true" />
      </button>
    </th>
  );
}

function ChartActions({asset}: {asset: Asset}) {
  const deployment = useDeployment();
  const holders = useVaults(deployment.data).vaults
    .filter(v => v.holdings.some(h => h.referenceAssetId === asset.id))
    .map(v => ({id: v.address, name: v.name}));
  return (
    <>
      <Link className="button button--secondary" href={createHref({assets: [asset.id]})}>
        <Plus size={15} /> Create portfolio with {asset.symbol}
      </Link>
      {holders.length > 0 && (
        <span className="chart-actions__held">
          Held in{' '}
          {holders.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <Link className="text-link" href={portfolioHref(p.id)}>{p.name}</Link>
            </span>
          ))}
        </span>
      )}
    </>
  );
}

export function Assets({initialAssetId, initialWindow}: {initialAssetId?: string; initialWindow?: WindowLabel}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<Sort>('symbol');
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [selectedId, setSelectedId] = useState(() => (initialAssetId && referenceAssetById(initialAssetId)?.id) || DEFAULT_ASSET);
  const [windowMs, setWindowMs] = useState<number>(() => windowMsOf(initialWindow));
  const chartRef = useRef<HTMLDivElement>(null);
  const state = usePriceState();
  const now = useNow();
  const selected = referenceAssets.find(a => a.id === selectedId) ?? referenceAssets[0];
  const status = apiStatusText(state);
  const priced = referenceAssets.filter(a => state.byAsset.has(a.id)).length;

  function select(id: string) {
    setSelectedId(id);
    replaceQuery({asset: id});
    // Stacked layout: the chart is above the list, so bring it into view.
    const chart = chartRef.current;
    if (chart && window.matchMedia('(max-width: 1099px)').matches) chart.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
  function chooseWindow(ms: number) {
    setWindowMs(ms);
    replaceQuery({window: windowLabelOf(ms)});
  }

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
    return [...rows].sort((a, b) => (sort === 'price' ? price(b) - price(a) : a.symbol.localeCompare(b.symbol, 'en')));
  }, [search, category, sort, state.byAsset]);

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Catalog / Reference assets</div>
        <h1>Assets</h1>
        <p>
          BNB Chain (56) tokens with a verified Atlas feed. USD reference prices come from the IndexFi API once per second. They are price references, not
          verified testnet collateral.
        </p>
      </div>
      <section className="summary-grid">
        <Card><Metric label="Reference assets" value={referenceAssets.length} detail="verified selection" /></Card>
        <Card><Metric label="Prices received" value={`${priced} / ${referenceAssets.length}`} detail="latest snapshot" /></Card>
        <Card>
          <Metric
            label="Last server sample"
            value={state.snapshot ? new Date(state.snapshot.snapshotAtMs).toLocaleTimeString([], {hour12: false}) : '—'}
            detail="server sample time, not oracle update time"
          />
        </Card>
        <Card><Metric label="Price API" value={<ApiStatusBadge state={state} />} detail={status.detail ?? undefined} /></Card>
      </section>

      <div className="assets-layout">
        <div className="assets-detail" ref={chartRef}>
          <AssetChart
            asset={selected}
            windowMs={windowMs}
            onWindow={chooseWindow}
            title={
              <span className="portfolio-name">
                <AssetIcon asset={selected} />
                <span><strong>{selected.symbol}</strong><small>{selected.name}</small></span>
              </span>
            }
            actions={<ChartActions asset={selected} />}
          />
        </div>

        <section className="assets-list" aria-label="Reference assets">
          <div className="toolbar">
            <div className="tabs category-tabs">
              {['All', ...referenceCategories].map(name => (
                <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
              ))}
            </div>
            <div className="toolbar-actions">
              <label className="search">
                <Search size={17} />
                <input aria-label="Search assets" placeholder="Symbol, name, address or feed" value={search} onChange={event => setSearch(event.target.value)} />
              </label>
              <div className="view-toggle">
                <button aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={18} /></button>
                <button aria-label="Card view" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={17} /></button>
              </div>
            </div>
          </div>
          <p className="muted list-count">{visible.length} assets · select one to chart it</p>

          {!visible.length ? (
            <Empty>No matching assets.</Empty>
          ) : view === 'table' ? (
            <Card className="market-table market-table--dense">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <SortHeader label="Asset" value="symbol" sort={sort} onSort={setSort} />
                      <th>Atlas feed · contract</th>
                      <SortHeader label="Reference price" value="price" sort={sort} onSort={setSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(asset => {
                      const price = state.byAsset.get(asset.id);
                      const isSelected = asset.id === selected.id;
                      return (
                        <tr key={asset.id} aria-selected={isSelected} className={`row-link${isSelected ? ' row--selected' : ''}`} onClick={() => select(asset.id)}>
                          <td>
                            <button className="portfolio-name row-button" onClick={event => { event.stopPropagation(); select(asset.id); }} aria-label={`Chart ${asset.symbol}`}>
                              <AssetIcon asset={asset} />
                              <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
                            </button>
                          </td>
                          <td title={asset.address}>
                            <span className="portfolio-name"><span><strong>#{asset.feedId} · {asset.feedName}</strong><small><code>{shortAddress(asset.address)}</code></small></span></span>
                          </td>
                          <td className="price-cell">
                            <PriceCell price={price} />
                            <small title={price ? `Source time ${new Date(price.sourceTimestamp * 1000).toISOString()}` : undefined}>{price ? ageLabel(price.sourceTimestamp, now) : 'no price yet'}</small>
                          </td>
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
                    <button className="text-link text-button" onClick={() => select(asset.id)}>Chart {asset.symbol}</button>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
