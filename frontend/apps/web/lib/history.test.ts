import {describe, expect, it} from 'vitest';
import {mergeSeries, splitAtGaps, trimToWindow, type SeriesPoint} from './history';

const T0 = Date.UTC(2026, 10, 25, 18, 30);
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
