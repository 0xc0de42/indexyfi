import {describe, expect, it} from 'vitest';
import {addItem, equalize, isEqualSplit, maxWeight, moveBoundary, normalize, removeItem, setWeight, totalOf} from './allocation';

const w = (...weights: number[]) => weights.map((weight, i) => ({id: `a${i}`, weight}));
const weights = (items: {weight: number}[]) => items.map(i => i.weight);

describe('allocation editing', () => {
  it('keeps exactly 100% when one weight changes, rebalancing others proportionally', () => {
    const next = setWeight(w(50, 30, 20), 0, 60);
    expect(weights(next)).toEqual([60, 24, 16]);
    expect(totalOf(next)).toBe(100);
  });

  it('never moves locked weights and clamps to what the locks allow', () => {
    const items = w(40, 30, 30);
    const next = setWeight(items, 0, 90, new Set([1]));
    expect(weights(next)).toEqual([69.5, 30, 0.5]);
    expect(maxWeight(items, 0, new Set([1]))).toBe(69.5);
    expect(totalOf(next)).toBe(100);
  });

  it('does nothing when every other weight is locked', () => {
    expect(weights(setWeight(w(50, 50), 0, 70, new Set([1])))).toEqual([50, 50]);
  });

  it('keeps every included asset at the 0.5% minimum', () => {
    const next = setWeight(w(25, 25, 25, 25), 0, 100);
    expect(weights(next)).toEqual([98.5, 0.5, 0.5, 0.5]);
    expect(weights(setWeight(w(50, 50), 0, 0))).toEqual([0.5, 99.5]);
  });

  it('spreads evenly when the others are all at the minimum', () => {
    expect(weights(setWeight(w(98.5, 0.5, 0.5, 0.5), 0, 40))).toEqual([40, 20, 20, 20]);
  });

  it('moves a boundary between two neighbours only', () => {
    expect(weights(moveBoundary(w(50, 30, 20), 1, 10))).toEqual([50, 10, 40]);
    expect(weights(moveBoundary(w(50, 30, 20), 1, 60))).toEqual([50, 49.5, 0.5]);
    expect(weights(moveBoundary(w(50, 30, 20), 0, 10, new Set([1])))).toEqual([50, 30, 20]);
  });

  it('adds an asset with an equal share and keeps custom proportions', () => {
    const next = addItem(w(60, 40), {id: 'new', weight: 0});
    expect(weights(next)).toEqual([40, 26.67, 33.33]);
    expect(totalOf(next)).toBe(100);
    expect(weights(addItem([], {id: 'first', weight: 0}))).toEqual([100]);
  });

  it('returns a removed weight proportionally and respects locks', () => {
    expect(weights(removeItem(w(50, 30, 20), 0))).toEqual([60, 40]);
    expect(weights(removeItem(w(50, 30, 20), 0, new Set([1])))).toEqual([30, 70]);
    expect(removeItem(w(100), 0)).toEqual([]);
  });

  it('normalizes legacy drafts and equalizes around locks', () => {
    expect(weights(normalize(w(10, 10, 20)))).toEqual([25, 25, 50]);
    expect(weights(normalize(w(0, 0, 0)))).toEqual([33.34, 33.33, 33.33]);
    expect(weights(equalize(w(50, 30, 20), new Set([0])))).toEqual([50, 25, 25]);
    expect(isEqualSplit(w(33.34, 33.33, 33.33))).toBe(true);
    expect(isEqualSplit(w(60, 40))).toBe(false);
  });

  it('rounds to two decimals without drifting', () => {
    let items = w(33.34, 33.33, 33.33);
    for (let i = 0; i < 50; i++) items = setWeight(items, i % 3, 10 + ((i * 7.31) % 60));
    expect(totalOf(items)).toBe(100);
    for (const weight of weights(items)) expect(Number.isInteger(Math.round(weight * 100))).toBe(true);
  });
});
