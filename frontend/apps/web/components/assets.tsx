'use client';
import Link from 'next/link';
import {useMemo, useRef, useState} from 'react';
import {ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List, Plus, Search} from 'lucide-react';
import {Card, Empty, Metric} from '@indexfi/ui';
import {referenceAssetById, referenceAssets, referenceCategories} from '@/lib/catalog';
import {useNow, usePriceState} from '@/lib/prices';
import {createHref, portfolioHref, replaceQuery, type WindowLabel} from '@/lib/routes';
import {useDeployment, useFlapDeployment, useVaults} from '@/lib/use-vaults';
import {ageLabel, formatPrice, type Asset} from '@/domain/model';
import type {AssetPrice} from '@/lib/api';
import {AssetIcon} from './asset-icon';
import {AssetChart, windowLabelOf, windowMsOf} from './asset-chart';
import {utcOffsetLabel} from '@/lib/chart-scale';
import {ApiStatusBadge, apiStatusText} from './api-status';
import {CmcStats} from './cmc-stats';
import {useCmcState} from '@/lib/cmc';
import {ASSET_SORTS, defaultDirection, queryAssets, type AssetSort, type SortDirection} from '@/lib/asset-query';
import {useAssetData} from '@/lib/use-asset-data';
import {cmcPct, cmcUsd, pctTone} from '@/lib/cmc-format';
import {describeCmcError} from '@/lib/cmc-api';

type Sort = AssetSort;
const DEFAULT_ASSET = referenceAssets.find(a => a.symbol === 'BTCB')?.id ?? referenceAssets[0].id;

function PriceCell({price}: {price?: AssetPrice}) {
  return <span title={price ? `${price.price} USD (exact)` : 'No price received yet'}>{formatPrice(price?.price)}</span>;
}

function SortHeader({label, value, sort, direction, onSort}: {label: string; value: Sort; sort: Sort; direction: SortDirection; onSort: (s: Sort) => void}) {
  return (
    <th aria-sort={sort === value ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button className="th-button" onClick={() => onSort(value)}>
        {label} <ArrowUpDown size={11} aria-hidden="true" />
      </button>
    </th>
  );
}

function ChartActions({asset}: {asset: Asset}) {
  const deployment = useDeployment();
  const flap = useFlapDeployment();
  const flapVaults = useVaults(flap.data ?? undefined).vaults;
  const holders = [...useVaults(deployment.data).vaults, ...flapVaults]
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
  const [sort, setSortKey] = useState<Sort>('symbol');
  const [direction, setDirection] = useState<SortDirection>('asc');
  // Choosing the active metric again flips the direction; a new metric starts at its natural direction.
  const setSort = (next: Sort) => { if (next === sort) setDirection(dir => (dir === 'asc' ? 'desc' : 'asc')); else { setSortKey(next); setDirection(defaultDirection(next)); } };
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [selectedId, setSelectedId] = useState(() => (initialAssetId && referenceAssetById(initialAssetId)?.id) || DEFAULT_ASSET);
  const [windowMs, setWindowMs] = useState<number>(() => windowMsOf(initialWindow));
  const cmc = useCmcState();
  const cmcQuote = (id: string) => cmc.rows.get(id)?.quote ?? null;
  const quoted = referenceAssets.filter(a => cmcQuote(a.id)).length;
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

  const dataOf = useAssetData(referenceAssets);
  // Same filtering and sorting as the Create composition step (lib/asset-query): Atlas and CMC metrics, missing values last.
  const visible = useMemo(() => queryAssets(referenceAssets, {term: search, category, sort, direction}, dataOf), [search, category, sort, direction, dataOf]);

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Catalog / Reference assets</div>
        <h1>Assets</h1>
        <p>
          BNB Chain (56) tokens with a verified Atlas feed. USD reference prices come from the IndexFi API once per second; CoinMarketCap market cap, volume and
          returns come from the same API every minute. Both are references, not verified testnet collateral or executable prices.
        </p>
      </div>
      <section className="summary-grid">
        <Card><Metric label="Reference assets" value={referenceAssets.length} detail="verified selection" /></Card>
        <Card><Metric label="Prices received" value={`${priced} / ${referenceAssets.length}`} detail="latest snapshot" /></Card>
        <Card>
          <Metric
            label="Last server sample"
            value={state.snapshot ? new Date(state.snapshot.snapshotAtMs).toLocaleTimeString([], {hour12: false}) : '—'}
            detail={`your local time (${utcOffsetLabel()}) · server sample time, not oracle update time`}
          />
        </Card>
        <Card><Metric label="Price API" value={<ApiStatusBadge state={state} />} detail={status.detail ?? undefined} /></Card>
        <Card><Metric label="CMC market data" value={`${quoted} / ${referenceAssets.length}`} detail={cmc.status === 'ok' ? 'quotes received · every 60 s' : cmc.error ? describeCmcError(cmc.error) : 'loading'} /></Card>
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
          <CmcStats asset={selected} />
        </div>

        <section className="assets-list" aria-label="Reference assets">
          <div className="toolbar">
            <div className="tabs category-tabs">
              {['All', ...referenceCategories].map(name => (
                <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>
              ))}
            </div>
            <div className="toolbar-actions">
              <label className="sort">
                <select aria-label="Sort assets" value={sort} onChange={e => { const next = e.target.value as Sort; setSortKey(next); setDirection(defaultDirection(next)); }}>
                  {ASSET_SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <button type="button" className="button button--secondary asset-filters__direction" aria-label={direction === 'desc' ? 'Highest first' : 'Lowest first'} onClick={() => setDirection(d => (d === 'desc' ? 'asc' : 'desc'))}>
                {direction === 'desc' ? <ArrowDown size={15} /> : <ArrowUp size={15} />}
                {sort === 'symbol' ? (direction === 'asc' ? 'A–Z' : 'Z–A') : direction === 'desc' ? 'High first' : 'Low first'}
              </button>
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
                      <SortHeader label="Asset" value="symbol" sort={sort} direction={direction} onSort={setSort} />
                      <SortHeader label="Reference price" value="price" sort={sort} direction={direction} onSort={setSort} />
                      <SortHeader label="Market cap · vol" value="cap" sort={sort} direction={direction} onSort={setSort} />
                      <SortHeader label="24h · 7d" value="ch24" sort={sort} direction={direction} onSort={setSort} />
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
                              <span title={`Atlas feed #${asset.feedId} · ${asset.feedName} · ${asset.address}`}><strong>{asset.symbol}</strong><small>{asset.name} · #{asset.feedId}</small></span>
                            </button>
                          </td>
                          <td className="price-cell">
                            <PriceCell price={price} />
                            <small title={price ? `Source time ${new Date(price.sourceTimestamp * 1000).toISOString()}` : undefined}>{price ? ageLabel(price.sourceTimestamp, now) : 'no price yet'}</small>
                          </td>
                          {(() => {
                            const q = cmcQuote(asset.id);
                            return (
                              <>
                                <td className="price-cell" title={q?.marketCap ? `Market cap ${q.marketCap} USD${q.rank ? ` · CMC rank #${q.rank}` : ''} · 24h volume ${q.volume24h ?? '—'} USD` : 'No CMC quote yet'}>
                                  <span>{cmcUsd(q?.marketCap)}</span><small>vol {cmcUsd(q?.volume24h)}</small>
                                </td>
                                <td className="price-cell">
                                  <span className={pctTone(q?.change24h)}>{cmcPct(q?.change24h)}</span><small className={pctTone(q?.change7d)}>7d {cmcPct(q?.change7d)}</small>
                                </td>
                              </>
                            );
                          })()}
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
                      <Metric label="Market cap" value={cmcUsd(cmcQuote(asset.id)?.marketCap)} />
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
