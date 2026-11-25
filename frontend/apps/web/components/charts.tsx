'use client';
import type {Portfolio} from '@/domain/model';
import {formatPrice} from '@/domain/model';
import {splitAtGaps, type SeriesPoint} from '@/lib/history';
import {useAssetPrice} from '@/lib/prices';
import {AssetIcon} from './asset-icon';

const W = 600;
const H = 200;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});

/**
 * One asset's reference price over [now - window, now]. Minute closes and 1 s live
 * samples are drawn as received; gaps longer than 90 s break the line.
 */
export function PriceLineChart({points, now, windowMs, label}: {points: readonly SeriesPoint[]; now: number; windowMs: number; label: string}) {
  const values = points.map(p => Number(p.price)).filter(Number.isFinite);
  if (!values.length) return <div className="empty chart-empty">No stored or live observations in this window yet.</div>;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.12, high * 0.0005);
  const min = low - pad;
  const max = high + pad;
  const from = now - windowMs;
  const x = (t: number) => Math.min(W, Math.max(0, ((t - from) / windowMs) * W));
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const segments = splitAtGaps(points);
  const last = points[points.length - 1];
  const first = points[0];
  const change = values.length > 1 ? (Number(last.price) / Number(first.price) - 1) * 100 : null;
  return (
    <div className="price-chart">
      <div className="chart-legend">
        <span><i className="legend-market" /> {label} reference price (USD)</span>
        <span>
          {formatPrice(first.price)} → {formatPrice(last.price)}
          {change !== null && <strong className={change < 0 ? 'negative' : 'positive'}> {change > 0 ? '+' : ''}{change.toFixed(3)}%</strong>}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} reference price history`}>
        {[0, 50, 100, 150, 200].map(v => <line key={v} x1="0" x2={W} y1={v} y2={v} className="chart-grid" />)}
        {segments.map((segment, i) =>
          segment.length > 1 ? (
            <path key={i} d={segment.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(Number(p.price)).toFixed(2)}`).join(' ')} className="chart-market" />
          ) : (
            <circle key={i} cx={x(segment[0].t)} cy={y(Number(segment[0].price))} r="2.5" fill="var(--chart-market)" />
          ),
        )}
      </svg>
      <div className="chart-axis">
        <span>{time(from)}</span>
        <span>{points.filter(p => p.origin === 'history').length} minute closes · {points.filter(p => p.origin === 'live').length} live samples</span>
        <span>{time(now)}</span>
      </div>
    </div>
  );
}

function ConstituentPrice({assetId}: {assetId: string}) {
  const price = useAssetPrice(assetId);
  return <span title={price ? `${price.price} USD` : undefined}>{formatPrice(price?.price)}</span>;
}

export function Allocation({portfolio: p}: {portfolio: Portfolio}) {
  return (
    <>
      <div className="allocation-bar">{p.allocations.map(a => <span key={a.asset.id} style={{width: `${a.weight}%`, background: a.asset.color}} />)}</div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Asset</th><th>Initial weight</th><th>Reference price</th><th>Current weight</th></tr></thead>
          <tbody>
            {p.allocations.map(a => (
              <tr key={a.asset.id}>
                <td><span className="portfolio-name"><AssetIcon asset={a.asset} /><span><strong>{a.asset.symbol}</strong><small>{a.asset.name}</small></span></span></td>
                <td>{a.weight}%</td>
                <td><ConstituentPrice assetId={a.asset.id} /></td>
                <td title="Requires on-chain holdings (Phase III)">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
