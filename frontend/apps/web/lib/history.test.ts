import {describe, expect, it} from 'vitest';
import type {PriceSnapshot} from './api';
import {MAX_LIVE_POINTS, SeriesTracker, mergeSeries, splitAtGaps, trimToWindow, type SeriesPoint} from './history';
import {BTCB, ETH} from './fixtures/wire';

const T0 = Date.UTC(2026, 10, 25, 18, 30);
const snap = (ms: number, prices: Record<string, string>): PriceSnapshot => ({
  snapshotAt: new Date(ms).toISOString(),
  snapshotAtMs: ms,
  prices: Object.entries(prices).map(([assetId, price]) => ({assetId, feedId: 1, price, sourceTimestamp: Math.floor(ms / 1000) - 1})),
});
const point = (t: number, price = '1', origin: SeriesPoint['origin'] = 'live'): SeriesPoint => ({t, price, sourceTimestamp: 0, origin});

describe('series merging', () => {
  it('combines minute closes with later 1 s samples chronologically', () => {
    const merged = mergeSeries([point(T0, 'a', 'history'), point(T0 + 60_000, 'b', 'history')], [point(T0 + 61_000, 'c'), point(T0 + 62_000, 'd')]);
    expect(merged.map(p => p.price)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('deduplicates overlapping sample timestamps, preferring the persisted close', () => {
    const merged = mergeSeries([point(T0 + 60_000, 'close', 'history')], [point(T0 + 59_000, 'x'), point(T0 + 60_000, 'live-copy'), point(T0 + 61_000, 'y')]);
    expect(merged.map(p => p.price)).toEqual(['x', 'close', 'y']);
  });
  it('preserves real gaps', () => {
    const segments = splitAtGaps([point(T0), point(T0 + 60_000), point(T0 + 300_000), point(T0 + 301_000)]);
    expect(segments.map(s => s.length)).toEqual([2, 2]);
  });
  it('bounds points to the selected window', () => {
    const points = [point(T0), point(T0 + 4 * 60_000), point(T0 + 6 * 60_000)];
    expect(trimToWindow(points, T0 + 6 * 60_000, 5 * 60_000).map(p => p.t)).toEqual([T0 + 4 * 60_000, T0 + 6 * 60_000]);
  });
});

describe('SeriesTracker', () => {
  it('keeps live samples that arrived before the history response', () => {
    const tracker = new SeriesTracker([BTCB]);
    tracker.addLive(snap(T0 + 120_500, {[BTCB]: '3'}));
    tracker.addLive(snap(T0 + 121_500, {[BTCB]: '4'}));
    tracker.setHistory([snap(T0 + 60_000, {[BTCB]: '1'}), snap(T0 + 120_000, {[BTCB]: '2'})]);
    expect(tracker.series(BTCB, T0 + 122_000, 5 * 60_000).map(p => p.price)).toEqual(['1', '2', '3', '4']);
  });
  it('handles empty and sparse history and assets missing from a snapshot', () => {
    const tracker = new SeriesTracker([BTCB, ETH]);
    tracker.setHistory([]);
    expect(tracker.series(BTCB, T0, 60_000)).toEqual([]);
    tracker.setHistory([snap(T0, {[BTCB]: '1'}), snap(T0 + 600_000, {[BTCB]: '2', [ETH]: '9'})]);
    expect(tracker.series(BTCB, T0 + 600_000, 3_600_000)).toHaveLength(2);
    expect(tracker.series(ETH, T0 + 600_000, 3_600_000).map(p => p.price)).toEqual(['9']);
  });
  it('ignores unknown assets and repeated samples, and bounds the live buffer', () => {
    const tracker = new SeriesTracker([BTCB]);
    tracker.addLive(snap(T0, {'56:0xunknown': '1'}));
    expect(tracker.series(BTCB, T0, 60_000)).toEqual([]);
    tracker.addLive(snap(T0, {[BTCB]: '1'}));
    tracker.addLive(snap(T0, {[BTCB]: '1'}));
    expect(tracker.series(BTCB, T0, 60_000)).toHaveLength(1);
    for (let i = 1; i <= MAX_LIVE_POINTS + 10; i++) tracker.addLive(snap(T0 + i * 1_000, {[BTCB]: String(i)}));
    const now = T0 + (MAX_LIVE_POINTS + 10) * 1_000;
    expect(tracker.series(BTCB, now, 24 * 3_600_000)).toHaveLength(MAX_LIVE_POINTS);
  });
  it('keeps live buffers of assets that stay tracked when the selection changes', () => {
    const tracker = new SeriesTracker([BTCB, ETH]);
    tracker.addLive(snap(T0, {[BTCB]: '1', [ETH]: '2'}));
    tracker.track([BTCB]);
    expect(tracker.series(BTCB, T0, 60_000)).toHaveLength(1);
    tracker.track([BTCB, ETH]);
    expect(tracker.series(ETH, T0, 60_000)).toEqual([]);
  });
});
