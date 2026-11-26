import {describe, expect, it} from 'vitest';
import {formatTick, nearestIndex, niceStep, priceScale, timeScale} from './chart-scale';

describe('niceStep', () => {
  it.each([
    [0.7, 1],
    [1.3, 2],
    [2.2, 2.5],
    [3, 5],
    [7, 10],
    [0.00042, 0.0005],
    [180, 200],
  ])('rounds %d up to %d', (raw, nice) => expect(niceStep(raw)).toBeCloseTo(nice, 12));
});

describe('priceScale', () => {
  it('covers the observed range with round ticks', () => {
    const scale = priceScale(59_812.4, 60_066.4);
    expect(scale.min).toBeLessThanOrEqual(59_812.4);
    expect(scale.max).toBeGreaterThanOrEqual(60_066.4);
    expect(scale.step).toBe(100);
    expect(scale.ticks).toEqual([59_800, 59_900, 60_000, 60_100]);
    expect(scale.decimals).toBe(0);
  });

  it('keeps enough decimals for sub-cent assets', () => {
    const scale = priceScale(0.00051, 0.00053);
    expect(scale.decimals).toBe(6);
    expect(new Set(scale.ticks.map(t => formatTick(t, scale.decimals))).size).toBe(scale.ticks.length);
  });

  it('gives a flat series a visible band', () => {
    const scale = priceScale(1, 1);
    expect(scale.min).toBeLessThan(1);
    expect(scale.max).toBeGreaterThan(1);
    expect(scale.ticks.length).toBeGreaterThan(1);
  });
});

describe('timeScale', () => {
  const from = Date.parse('2026-11-25T21:40:36Z');

  it('uses one-minute ticks for a five-minute window', () => {
    const scale = timeScale(from, from + 5 * 60_000);
    expect(scale.step).toBe(60_000);
    expect(scale.ticks).toHaveLength(5);
    expect(scale.withSeconds).toBe(false);
    for (const t of scale.ticks) expect(t % 60_000).toBe(0);
  });

  it('keeps ticks inside the window for 24 h', () => {
    const scale = timeScale(from, from + 24 * 3_600_000);
    expect(scale.ticks.length).toBeLessThanOrEqual(5);
    expect(scale.ticks.every(t => t >= from && t <= from + 24 * 3_600_000)).toBe(true);
  });
});

describe('nearestIndex', () => {
  it('finds the closest sorted time', () => {
    const times = [0, 10, 20, 30];
    expect(nearestIndex(times, -5)).toBe(0);
    expect(nearestIndex(times, 14)).toBe(1);
    expect(nearestIndex(times, 16)).toBe(2);
    expect(nearestIndex(times, 99)).toBe(3);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('time zone labels', async () => {
  const {utcOffsetLabel, ageText} = await import('./chart-scale');
  it('labels the local UTC offset and ages', () => {
    expect(utcOffsetLabel()).toMatch(/^UTC([+−]\d{1,2}(:\d{2})?)?$/);
    expect(ageText(Date.now() - 480_000)).toBe('8 min ago');
    expect(ageText(Date.now() - 30_000)).toBe('30 s ago');
  });
});
