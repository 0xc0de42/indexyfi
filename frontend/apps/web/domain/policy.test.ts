import {describe, it, expect} from 'vitest';
import {draftErrors, equalWeights} from './policy';
import {referenceAssets} from '../lib/catalog';
import {formatPrice, ageLabel} from './model';

const draft = {name: 'Test', symbol: 'TEST', description: '', category: 'Crypto', allocations: [{asset: referenceAssets[0], weight: 50}, {asset: referenceAssets[1], weight: 50}], funding: 100};

describe('draft rules', () => {
  it('checks weights', () => {
    expect(draftErrors(draft)).toEqual([]);
    expect(draftErrors({...draft, allocations: draft.allocations.map(a => ({...a, weight: 40}))})).toContain('Weights must total 100%.');
  });
  it('rejects duplicates and non-positive funding', () => {
    expect(draftErrors({...draft, allocations: [draft.allocations[0], draft.allocations[0]]})).toContain('Duplicate assets are not allowed.');
    expect(draftErrors({...draft, funding: 0})).toContain('Funding must be at least 100 USDT.');
  });
  it('equal allocations total 100', () => {
    expect(equalWeights([0, 1, 2].map(() => ({weight: 0}))).reduce((s, a) => s + a.weight, 0)).toBeCloseTo(100);
  });
});

describe('display formatting', () => {
  it('formats exact decimal strings only at the display boundary', () => {
    expect(formatPrice('91234.123456789012345678')).toBe('$91,234.12');
    expect(formatPrice('0.99985')).toBe('$0.9999');
    expect(formatPrice('0.0000123')).toBe('$0.000012300');
    expect(formatPrice(undefined)).toBe('—');
  });
  it('labels source-time age', () => {
    expect(ageLabel(100, 105_000)).toBe('5s ago');
    expect(ageLabel(100, 100_000 + 600_000)).toBe('10m ago');
  });
});
