/**
 * Index rules: a portfolio can track "the N largest assets of a category by CMC market cap" (an S&P-style top-cap
 * index, e.g. the largest tokenized tech equities) instead of a fixed hand-picked list. At launch the rule selects and
 * weights the constituents from current CMC data; with vault 5.2+ the index operator re-selects and re-weights them at
 * each rebalance (docs/rebalancing/IMPLEMENTATION_PLAN.md §4). Pure functions; callers pass the data.
 */
import type {Asset} from '@/domain/model';
import {MIN_BPS, TOTAL_BPS} from '@/domain/allocation';
import {compareDecimal} from './decimal';

export type IndexRule = {
  readonly kind: 'manual' | 'topCap';
  /** 'All' or a reference category. */
  readonly universe: string;
  readonly size: number;
  readonly weighting: 'cap' | 'equal';
  /** Per-constituent weight cap in bps (0 = none); applies to cap weighting. */
  readonly maxWeightBps: number;
};
export const INDEX_SIZES = [3, 5, 10, 15, 20] as const;
export const INDEX_CAPS_BPS = [0, 1_000, 2_500, 3_500] as const;
export const DEFAULT_INDEX_RULE: IndexRule = {kind: 'manual', universe: 'Tokenized equity', size: 10, weighting: 'cap', maxWeightBps: 2_500};

export const capLabel = (bps: number) => (bps === 0 ? 'No cap' : `${bps / 100}%`);
/** A cap is feasible only if size × cap covers 100%. */
export const capFeasible = (size: number, capBps: number) => capBps === 0 || size * capBps >= TOTAL_BPS;
export function isValidIndexRule(r: IndexRule, categories: readonly string[]): boolean {
  return (r.kind === 'manual' || r.kind === 'topCap')
    && (r.universe === 'All' || categories.includes(r.universe))
    && (INDEX_SIZES as readonly number[]).includes(r.size)
    && (r.weighting === 'cap' || r.weighting === 'equal')
    && (INDEX_CAPS_BPS as readonly number[]).includes(r.maxWeightBps)
    && capFeasible(r.size, r.maxWeightBps);
}
export function ruleLabel(r: IndexRule): string {
  if (r.kind === 'manual') return 'Manual selection';
  const universe = r.universe === 'All' ? 'all assets' : r.universe;
  const weights = r.weighting === 'equal' ? 'equal-weighted' : `market-cap weighted${r.maxWeightBps ? `, max ${capLabel(r.maxWeightBps)} each` : ''}`;
  return `Top ${r.size} ${universe} by CMC market cap, ${weights}`;
}

export interface Candidate {
  readonly asset: Asset;
  /** CMC market cap, exact decimal string. */
  readonly marketCap: string;
}
export interface IndexSelection {
  readonly constituents: readonly (Candidate & {readonly weightBps: number})[];
  /** Eligible assets in the universe that had a usable market cap. */
  readonly eligible: number;
  /** Assets in the universe skipped for a missing or non-positive market cap. */
  readonly missing: readonly Asset[];
}

/**
 * Select the top `size` assets of the universe by market cap (exact decimal, ties by canonical id) and weight them.
 * Only assets the deployment can execute should be passed in; missing caps are excluded, never guessed.
 */
export function selectIndex(assets: readonly Asset[], rule: IndexRule, capOf: (asset: Asset) => string | null | undefined): IndexSelection {
  const universe = assets.filter(a => rule.universe === 'All' || a.category === rule.universe);
  const ranked: Candidate[] = [];
  const missing: Asset[] = [];
  for (const asset of universe) {
    const cap = capOf(asset);
    if (cap && compareDecimal(cap, '0') > 0) ranked.push({asset, marketCap: cap});
    else missing.push(asset);
  }
  ranked.sort((a, b) => compareDecimal(b.marketCap, a.marketCap) || a.asset.id.localeCompare(b.asset.id));
  const chosen = ranked.slice(0, rule.size);
  const bps = rule.weighting === 'equal' ? equalBps(chosen.length) : capWeightBps(chosen.map(c => Number(c.marketCap)), rule.maxWeightBps);
  return {constituents: chosen.map((c, i) => ({...c, weightBps: bps[i]})), eligible: ranked.length, missing};
}

function equalBps(n: number): number[] {
  if (!n) return [];
  const base = Math.floor(TOTAL_BPS / n);
  return Array.from({length: n}, (_, i) => base + (i < TOTAL_BPS - base * n ? 1 : 0));
}

/**
 * Market-cap weights in bps summing to exactly 10,000: proportional to cap, each capped at `maxBps` (excess
 * redistributed proportionally among the uncapped, repeated until stable), each at least MIN_BPS (50), then rounded by
 * largest remainder (ties to the earlier, i.e. larger, constituent). Inputs must be positive and in rank order.
 */
export function capWeightBps(caps: readonly number[], maxBps = 0): number[] {
  const n = caps.length;
  if (!n) return [];
  const limit = maxBps > 0 && n * maxBps >= TOTAL_BPS ? maxBps : TOTAL_BPS;
  const w = new Array<number>(n).fill(0);
  const fixed = new Array<boolean>(n).fill(false);
  for (let round = 0; round <= n; round++) {
    const free = caps.map((_, i) => i).filter(i => !fixed[i]);
    const left = TOTAL_BPS - w.reduce((s, x, i) => s + (fixed[i] ? x : 0), 0);
    const sum = free.reduce((s, i) => s + caps[i], 0);
    for (const i of free) w[i] = (left * caps[i]) / sum;
    let changed = false;
    for (const i of free) {
      if (w[i] > limit) { w[i] = limit; fixed[i] = true; changed = true; }
      else if (w[i] < MIN_BPS) { w[i] = MIN_BPS; fixed[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  const floors = w.map(Math.floor);
  let rest = TOTAL_BPS - floors.reduce((s, x) => s + x, 0);
  const order = w.map((x, i) => ({i, r: x - Math.floor(x)})).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) floors[order[k].i]++;
  return floors;
}

export interface Reconstitution {
  readonly add: readonly Asset[];
  readonly remove: readonly string[];
}
/** What a reconstitution would change now: selected assets not held, and held reference ids no longer selected. */
export function reconstitutionPreview(held: readonly string[], selection: IndexSelection): Reconstitution {
  const next = new Set(selection.constituents.map(c => c.asset.id));
  const current = new Set(held);
  return {add: selection.constituents.filter(c => !current.has(c.asset.id)).map(c => c.asset), remove: held.filter(id => !next.has(id))};
}
