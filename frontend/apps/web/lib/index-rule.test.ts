import {describe, expect, it} from 'vitest';
import {capFeasible, capWeightBps, DEFAULT_INDEX_RULE, isValidIndexRule, reconstitutionPreview, ruleLabel, selectIndex} from './index-rule';
import {referenceAssets, referenceCategories} from './catalog';

const equities = referenceAssets.filter(a => a.category === 'Tokenized equity');
const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe('market-cap weighting', () => {
  it('is proportional and totals exactly 10,000 bps', () => {
    expect(capWeightBps([600, 300, 100])).toEqual([6_000, 3_000, 1_000]);
    const w = capWeightBps([1, 1, 1]);
    expect(sum(w)).toBe(10_000);
    expect(w).toEqual([3_334, 3_333, 3_333]);
  });
  it('caps the largest and redistributes the excess proportionally', () => {
    const w = capWeightBps([900, 50, 30, 20], 3_500);
    expect(sum(w)).toBe(10_000);
    expect(w[0]).toBe(3_500);
    expect(Math.max(...w)).toBeLessThanOrEqual(3_500);
    expect(w[1]).toBeGreaterThan(w[2]);
  });
  it('enforces the 50 bps floor and ignores infeasible caps', () => {
    const w = capWeightBps([1e12, 1, 1]);
    expect(sum(w)).toBe(10_000);
    expect(Math.min(...w)).toBe(50);
    expect(capFeasible(5, 1_000)).toBe(false);
    expect(capWeightBps([5, 4, 3, 2, 1], 1_000)).toEqual(capWeightBps([5, 4, 3, 2, 1])); // 5 × 10% < 100%: no cap
  });
});

describe('top-N selection by CMC market cap', () => {
  const caps = new Map(equities.map((a, i) => [a.id, String((i + 1) * 1_000_000)]));
  it('selects the largest of the universe, exact decimal ranking, missing caps excluded', () => {
    const missingId = equities[equities.length - 1].id; // would otherwise be the largest
    const sel = selectIndex(referenceAssets, {...DEFAULT_INDEX_RULE, kind: 'topCap', size: 5}, a => (a.id === missingId ? null : caps.get(a.id)));
    expect(sel.constituents).toHaveLength(5);
    expect(sel.constituents[0].asset.id).toBe(equities[equities.length - 2].id);
    expect(sel.constituents.every(c => c.asset.category === 'Tokenized equity')).toBe(true);
    expect(sel.missing.map(a => a.id)).toEqual([missingId]);
    expect(sum(sel.constituents.map(c => c.weightBps))).toBe(10_000);
  });
  it('equal weighting and a short universe return what exists, never padding', () => {
    const sel = selectIndex(equities.slice(0, 3), {...DEFAULT_INDEX_RULE, kind: 'topCap', size: 10, weighting: 'equal'}, a => caps.get(a.id));
    expect(sel.constituents.map(c => c.weightBps)).toEqual([3_334, 3_333, 3_333]);
    expect(sel.eligible).toBe(3);
  });
  it('previews a reconstitution against current holdings', () => {
    const sel = selectIndex(equities, {...DEFAULT_INDEX_RULE, kind: 'topCap', size: 5}, a => caps.get(a.id));
    const held = [equities[0].id, sel.constituents[0].asset.id];
    const p = reconstitutionPreview(held, sel);
    expect(p.remove).toEqual([equities[0].id]);
    expect(p.add).toHaveLength(4);
  });
  it('validates rules and labels them', () => {
    expect(isValidIndexRule(DEFAULT_INDEX_RULE, referenceCategories)).toBe(true);
    expect(isValidIndexRule({...DEFAULT_INDEX_RULE, size: 7}, referenceCategories)).toBe(false);
    expect(isValidIndexRule({...DEFAULT_INDEX_RULE, universe: 'Tech'}, referenceCategories)).toBe(false);
    expect(isValidIndexRule({...DEFAULT_INDEX_RULE, size: 5, maxWeightBps: 1_000}, referenceCategories)).toBe(false);
    expect(ruleLabel({...DEFAULT_INDEX_RULE, kind: 'topCap'})).toBe('Top 10 Tokenized equity by CMC market cap, market-cap weighted, max 25% each');
  });
});

describe('index rule storage and on-chain encoding', async () => {
  const {EMPTY_DRAFT, parseDraft, serializeDraft} = await import('./draft');
  const {indexRuleArg} = await import('./vaults');
  const {keccak256, toHex, zeroHash} = await import('viem');
  it('survives draft storage; invalid stored rules fall back to manual', () => {
    const rule = {kind: 'topCap', universe: 'Tokenized equity', size: 15, weighting: 'cap', maxWeightBps: 1_000} as const;
    expect(parseDraft(serializeDraft({...EMPTY_DRAFT, index: rule}, 1))?.draft.index).toEqual(rule);
    expect(parseDraft(JSON.stringify({index: {...rule, size: 3}}))?.draft.index).toEqual(DEFAULT_INDEX_RULE);
  });
  it('encodes kind, weighting and the universe hash for the 5.2 factory', () => {
    expect(indexRuleArg(DEFAULT_INDEX_RULE)).toEqual({kind: 0, size: 0, weighting: 0, maxWeightBps: 0, universe: zeroHash});
    expect(indexRuleArg({...DEFAULT_INDEX_RULE, kind: 'topCap'})).toEqual({kind: 1, size: 10, weighting: 0, maxWeightBps: 2_500, universe: keccak256(toHex('Tokenized equity'))});
    expect(indexRuleArg({...DEFAULT_INDEX_RULE, kind: 'topCap', universe: 'All', weighting: 'equal'})).toMatchObject({weighting: 1, maxWeightBps: 0, universe: zeroHash});
  });
});
