'use client';
import {useState, type PointerEvent} from 'react';
import {formatPrice} from '@/domain/model';
import {formatClock, formatTick, nearestIndex, priceScale, timeScale} from '@/lib/chart-scale';
import {splitAtGaps, type SeriesPoint} from '@/lib/history';
import {useAssetPrice} from '@/lib/prices';
import Link from 'next/link';
import {assetHref} from '@/lib/routes';
import {AssetIcon} from './asset-icon';

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * One asset's reference price over [now - window, now], with a USD price axis, a
 * local-time axis and a hover readout of the exact observation. Minute closes and
 * 1 s live samples are drawn as received; gaps longer than 90 s break the line.
 * The plot is a 0–100 viewBox stretched to the container; labels are HTML so text
 * is never distorted.
 */
export function PriceLineChart({
  points,
  now,
  windowMs,
  label,
  windowLabel,
}: {
  points: readonly SeriesPoint[];
  now: number;
  windowMs: number;
  label: string;
  windowLabel: string;
}) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const series = points.filter(p => Number.isFinite(Number(p.price)));
  if (!series.length) return <div className="empty chart-empty">No stored or live observations in this window yet.</div>;

  const values = series.map(p => Number(p.price));
  const y = priceScale(Math.min(...values), Math.max(...values));
  const from = now - windowMs;
  const x = timeScale(from, now);
  const px = (t: number) => clamp(((t - from) / windowMs) * 100);
  const py = (v: number) => clamp(((y.max - v) / (y.max - y.min)) * 100);

  const first = series[0];
  const last = series[series.length - 1];
  const change = series.length > 1 ? (Number(last.price) / Number(first.price) - 1) * 100 : null;
  const segments = splitAtGaps(series);
  const line = (segment: readonly SeriesPoint[]) => segment.map((p, j) => `${j ? 'L' : 'M'}${px(p.t).toFixed(3)},${py(Number(p.price)).toFixed(3)}`).join(' ');
  const area = (segment: readonly SeriesPoint[]) => `${line(segment)} L${px(segment[segment.length - 1].t).toFixed(3)},100 L${px(segment[0].t).toFixed(3)},100 Z`;

  const hovered = hoverX === null ? null : series[nearestIndex(series.map(p => p.t), from + (hoverX / 100) * windowMs)];
  const focus = hovered ?? last;
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHoverX(clamp(((event.clientX - box.left) / box.width) * 100));
  };
  const history = series.filter(p => p.origin === 'history').length;

  return (
    <div className="price-chart">
      <div className="price-chart__head">
        <div>
          <span className="price-chart__price" title={`${focus.price} USD (exact)`}>{formatPrice(focus.price)}</span>
          {hovered ? (
            <span className="price-chart__when">{formatClock(hovered.t, true)} · {hovered.origin === 'history' ? 'minute close' : 'live sample'}</span>
          ) : (
            change !== null && (
              <span className={`price-chart__change ${change < 0 ? 'negative' : 'positive'}`}>
                {change > 0 ? '+' : ''}{change.toFixed(3)}% <small>{windowLabel}</small>
              </span>
            )
          )}
        </div>
        <span className="price-chart__unit">{label} / USD · reference</span>
      </div>

      <div className="price-chart__body">
        <div className="price-chart__plot" onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${label} reference price, last ${windowLabel}`}>
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" className="chart-fill-top" />
                <stop offset="100%" className="chart-fill-bottom" />
              </linearGradient>
            </defs>
            {y.ticks.map(v => <line key={`y${v}`} x1="0" x2="100" y1={py(v)} y2={py(v)} className="chart-grid" />)}
            {x.ticks.map(t => <line key={`x${t}`} x1={px(t)} x2={px(t)} y1="0" y2="100" className="chart-grid chart-grid--time" />)}
            {segments.map((segment, i) => (segment.length > 1 ? <path key={`a${i}`} d={area(segment)} className="chart-area" /> : null))}
            {segments.map((segment, i) => (segment.length > 1 ? <path key={`l${i}`} d={line(segment)} className="chart-market" /> : null))}
            <line x1="0" x2="100" y1={py(Number(last.price))} y2={py(Number(last.price))} className="chart-last-line" />
          </svg>
          {segments.filter(s => s.length === 1).map(([p]) => (
            <i key={p.t} className="price-chart__dot price-chart__dot--single" style={{left: `${px(p.t)}%`, top: `${py(Number(p.price))}%`}} />
          ))}
          <i className="price-chart__dot price-chart__dot--last" style={{left: `${px(last.t)}%`, top: `${py(Number(last.price))}%`}} />
          {hovered && (
            <>
              <i className="price-chart__cursor" style={{left: `${px(hovered.t)}%`}} />
              <i className="price-chart__dot" style={{left: `${px(hovered.t)}%`, top: `${py(Number(hovered.price))}%`}} />
            </>
          )}
        </div>
        <div className="price-chart__y" aria-hidden="true">
          {y.ticks
            .filter(v => Math.abs(py(v) - py(Number(last.price))) > 5) // keep the last-price chip readable
            .map(v => <span key={v} style={{top: `${py(v)}%`}}>{formatTick(v, y.decimals)}</span>)}
          <span className="price-chart__last" style={{top: `${py(Number(last.price))}%`}}>{formatTick(Number(last.price), Math.max(y.decimals, 2))}</span>
        </div>
        <div className="price-chart__x" aria-hidden="true">
          {x.ticks.map(t => <span key={t} style={{left: `${px(t)}%`}}>{formatClock(t, x.withSeconds)}</span>)}
        </div>
      </div>

      <div className="chart-axis">
        <span>{formatClock(from, true)} – {formatClock(now, true)} local time</span>
        <span>{history} minute closes · {series.length - history} live samples</span>
      </div>
    </div>
  );
}

function ConstituentPrice({assetId}: {assetId: string}) {
  const price = useAssetPrice(assetId);
  return <span title={price ? `${price.price} USD` : undefined}>{formatPrice(price?.price)}</span>;
}

