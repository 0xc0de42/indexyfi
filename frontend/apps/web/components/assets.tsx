'use client';
import {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import {Badge, Card, Empty, Metric} from '@indexfi/ui';
import {catalogAssets, catalogFeedIds, feedSelectionPolicy, type CatalogAsset} from '@/lib/catalog';
import {isStale, useLivePrices, useNow, type PriceState, type FeedPrice} from '@/lib/prices';
import {usd} from '@/domain/model';
import {AssetIcon} from './asset-icon';

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const priceDigits = (price: number) => (price >= 1 ? 2 : price >= 0.01 ? 4 : 6);
const filters = ['All', 'Live', 'Stale or missing', 'Needs review'] as const;
type Filter = (typeof filters)[number];

const streamBadge: Record<PriceState['status'], {tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string}> = {
  live: {tone: 'good', label: 'Live'},
  connecting: {tone: 'neutral', label: 'Connecting…'},
  reconnecting: {tone: 'warn', label: 'Reconnecting'},
  disabled: {tone: 'bad', label: 'Not configured'},
};

function SelectionBadge({asset}: {asset: CatalogAsset}) {
  if (asset.feedRule === 'explicit_override') return <Badge tone="warn">Override</Badge>;
  if (asset.feedRule === 'only_candidate_non_standard_weighting') return <Badge tone="warn">{asset.catalog.atlas_feed.weighting?.toLowerCase() ?? 'non-standard'}</Badge>;
  return <Badge>Standard</Badge>;
}

function Consensus({price}: {price?: FeedPrice}) {
  const status = price?.consensusStatus;
  if (!status) return <span className="muted">—</span>;
  return <Badge tone={status === 'HEALTHY' ? 'good' : status === 'DEGRADED' ? 'warn' : 'bad'}>{status.toLowerCase()}</Badge>;
}

export function Assets() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('All');
  const stream = useLivePrices(catalogFeedIds);
  const now = useNow();

  const live = catalogAssets.filter(asset => !isStale(stream.prices[asset.feedId], now)).length;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalogAssets.filter(asset => {
      const price = stream.prices[asset.feedId];
      if (filter === 'Live' && isStale(price, now)) return false;
      if (filter === 'Stale or missing' && !isStale(price, now)) return false;
      if (filter === 'Needs review' && asset.feedRule === 'only_candidate') return false;
      return !term || `${asset.symbol} ${asset.name} ${asset.catalog.address} ${asset.feedId} ${asset.atlasFeedName}`.toLowerCase().includes(term);
    });
  }, [search, filter, stream.prices, now]);
  const badge = streamBadge[stream.status];

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Catalog / Assets</div>
        <h1>Assets</h1>
        <p>
          BNB Chain tokens matched to exactly one Atlas price feed (policy {feedSelectionPolicy.version}). Prices stream from the IndexFi
          price server, never directly from Atlas.
        </p>
      </div>
      <section className="summary-grid">
        <Card><Metric label="Catalog assets" value={catalogAssets.length} /></Card>
        <Card><Metric label="Atlas feeds" value={catalogFeedIds.length} detail={`pull access ${feedSelectionPolicy.api_access}`} /></Card>
        <Card><Metric label="Live prices" value={`${live} / ${catalogAssets.length}`} detail={`fresh within 10 s`} /></Card>
        <Card><Metric label="Price stream" value={<Badge tone={badge.tone}>{badge.label}</Badge>} detail={stream.status === 'live' ? undefined : stream.error ?? undefined} /></Card>
      </section>
      <section className="section-heading">
        <div className="tabs category-tabs">
          {filters.map(name => <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}
        </div>
        <label className="search">
          <Search size={17} />
          <input aria-label="Search assets" placeholder="Symbol, name, address or feed" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </section>
      {!visible.length ? (
        <Empty>No matching assets.</Empty>
      ) : (
        <Card className="market-table">
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Asset</th><th>Contract</th><th>Atlas feed</th><th>Selection</th><th>Price</th><th>Updated</th><th>Consensus</th></tr>
              </thead>
              <tbody>
                {visible.map(asset => {
                  const price = stream.prices[asset.feedId];
                  const stale = isStale(price, now);
                  return (
                    <tr key={asset.id}>
                      <td>
                        <span className="portfolio-name">
                          <AssetIcon asset={asset} />
                          <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
                        </span>
                      </td>
                      <td title={asset.catalog.address}><code>{shortAddress(asset.catalog.address)}</code></td>
                      <td><span className="portfolio-name"><span><strong>#{asset.feedId}</strong><small>{asset.atlasFeedName}</small></span></span></td>
                      <td><SelectionBadge asset={asset} /></td>
                      <td className={price && stale ? 'muted' : undefined}>{price ? usd(price.price, priceDigits(price.price)) : '—'}</td>
                      <td className={price && stale ? 'negative' : undefined}>{price ? `${Math.max(0, Math.round(now / 1000 - price.timestamp))}s ago` : '—'}</td>
                      <td><Consensus price={price} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
