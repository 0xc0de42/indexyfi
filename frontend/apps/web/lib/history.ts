import type {PriceSnapshot} from './api';

/**
 * Chart series = persisted minute closes from `/history` merged with the 1-second
 * `/snapshot` samples observed since the app started. Points are keyed by server
 * sample time per asset, so a minute close that was also seen live appears once.
 * Real gaps are preserved; nothing is interpolated or backfilled.
 */
export interface SeriesPoint {
  /** Server sample time, epoch ms. */
  readonly t: number;
  /** Exact decimal string. */
  readonly price: string;
  readonly sourceTimestamp: number;
  readonly origin: 'history' | 'live';
}

/** Consecutive points further apart than this are drawn as a gap. */
export const GAP_MS = 90_000;

export function pointsFor(snapshots: readonly PriceSnapshot[], assetId: string, origin: SeriesPoint['origin']): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const snapshot of snapshots) {
    if (!Number.isFinite(snapshot.snapshotAtMs)) continue;
    const price = snapshot.prices.find(p => p.assetId === assetId);
    if (price) points.push({t: snapshot.snapshotAtMs, price: price.price, sourceTimestamp: price.sourceTimestamp, origin});
  }
  return points;
}

/** Chronological union; on equal timestamps the persisted (history) point wins. */
export function mergeSeries(history: readonly SeriesPoint[], live: readonly SeriesPoint[]): SeriesPoint[] {
  const byTime = new Map<number, SeriesPoint>();
  for (const point of live) byTime.set(point.t, point);
  for (const point of history) byTime.set(point.t, point);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function trimToWindow(points: readonly SeriesPoint[], now: number, windowMs: number): SeriesPoint[] {
  const from = now - windowMs;
  return points.filter(point => point.t >= from && point.t <= now + 5_000);
}

export function splitAtGaps(points: readonly SeriesPoint[], gapMs = GAP_MS): SeriesPoint[][] {
  const segments: SeriesPoint[][] = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (current && point.t - current[current.length - 1].t <= gapMs) current.push(point);
    else segments.push([point]);
  }
  return segments;
}
