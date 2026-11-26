/**
 * Dynamic rebalancing (docs/rebalancing/IMPLEMENTATION_PLAN.md). Settings are chosen at launch and stored on chain by
 * IndexFi vault 5.2+; the contract enforces them and a keeper (or anyone) triggers the rebalance. Drift shown here is
 * computed in the browser from on-chain holdings × latest Atlas prices, the same definition the contract uses.
 */
import type {Valuation} from './valuation';

export const REBALANCE_INTERVALS = [
  {seconds: 0, label: 'Off'},
  {seconds: 3_600, label: '1 h'},
  {seconds: 10_800, label: '3 h'},
  {seconds: 86_400, label: '1 day'},
  {seconds: 259_200, label: '3 days'},
  {seconds: 604_800, label: '1 week'},
] as const;
export const REBALANCE_THRESHOLDS_BPS = [10, 100, 300, 500] as const;

export interface RebalanceSettings {
  /** Minimum seconds between rebalances; 0 = off. */
  readonly intervalSeconds: number;
  readonly thresholdBps: number;
}
export const DEFAULT_REBALANCE: RebalanceSettings = {intervalSeconds: 86_400, thresholdBps: 100};

export const isValidRebalance = (s: RebalanceSettings) =>
  REBALANCE_INTERVALS.some(i => i.seconds === s.intervalSeconds) && (REBALANCE_THRESHOLDS_BPS as readonly number[]).includes(s.thresholdBps);
export const intervalLabel = (seconds: number) => REBALANCE_INTERVALS.find(i => i.seconds === seconds)?.label ?? `${Math.round(seconds / 3600)} h`;
export const bpsLabel = (bps: number) => `${(bps / 100).toLocaleString('en-US', {maximumFractionDigits: 2})}%`;
export const settingsLabel = (s: RebalanceSettings) =>
  s.intervalSeconds === 0 ? 'Off' : `At most every ${intervalLabel(s.intervalSeconds)}, when drift ≥ ${bpsLabel(s.thresholdBps)}`;

export interface LegDrift {
  readonly referenceAssetId: string;
  readonly symbol: string;
  readonly targetPct: number;
  readonly actualPct: number;
  /** actual − target, percentage points. */
  readonly diffPct: number;
}
export interface Drift {
  /** max |actual − target| in basis points of portfolio value; null without a price for every holding. */
  readonly driftBps: number | null;
  /** Largest deviations first. */
  readonly legs: readonly LegDrift[];
}

export function driftOf(val: Pick<Valuation, 'holdings'>): Drift {
  if (!val.holdings.length || val.holdings.some(h => h.valuePct === null)) return {driftBps: null, legs: []};
  const legs = val.holdings
    .map(h => ({referenceAssetId: h.referenceAssetId, symbol: h.symbol, targetPct: h.targetPct, actualPct: h.valuePct!, diffPct: h.valuePct! - h.targetPct}))
    .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct) || a.referenceAssetId.localeCompare(b.referenceAssetId));
  return {driftBps: Math.abs(legs[0].diffPct) * 100, legs};
}

export type RebalanceState = 'off' | 'cooldown' | 'below_threshold' | 'due' | 'unknown';
export interface RebalanceStatus {
  readonly state: RebalanceState;
  /** Unix seconds when the interval has passed (null when off). */
  readonly eligibleAt: number | null;
}

/** Same rule the contract enforces: interval > 0, now ≥ last + interval, drift ≥ threshold. */
export function rebalanceStatus(s: RebalanceSettings, lastRebalanceAt: number, driftBps: number | null, nowSeconds: number): RebalanceStatus {
  if (s.intervalSeconds === 0) return {state: 'off', eligibleAt: null};
  const eligibleAt = lastRebalanceAt + s.intervalSeconds;
  if (nowSeconds < eligibleAt) return {state: 'cooldown', eligibleAt};
  if (driftBps === null) return {state: 'unknown', eligibleAt};
  return {state: driftBps >= s.thresholdBps ? 'due' : 'below_threshold', eligibleAt};
}

export function relativeTime(targetSeconds: number, nowSeconds: number): string {
  const d = targetSeconds - nowSeconds, a = Math.abs(d);
  const text = a < 90 ? `${Math.round(a)} s` : a < 5_400 ? `${Math.round(a / 60)} min` : a < 129_600 ? `${(a / 3_600).toFixed(1)} h` : `${(a / 86_400).toFixed(1)} days`;
  return d >= 0 ? `in ${text}` : `${text} ago`;
}

export interface RebalanceTrade {
  readonly referenceAssetId: string;
  readonly symbol: string;
  readonly side: 'sell' | 'buy';
  /** USD value to sell or buy (at the latest Atlas price). */
  readonly usd: number;
  readonly fromPct: number;
  readonly toPct: number;
}
export interface RebalancePlan {
  readonly trades: readonly RebalanceTrade[];
  /** Total USD sold (= bought), the turnover. */
  readonly turnoverUsd: number;
  /** PancakeSwap V2 fees on both legs (0.25% each), an estimate. */
  readonly feeUsd: number;
}
/**
 * The trades a rebalance would make to return every holding to its target weight, through USDT: sell the overweight
 * assets, buy the underweight ones. Display only (the demo does not execute it); null without a price for every holding.
 */
export function rebalancePlan(val: Pick<Valuation, 'holdings'>, minUsd = 0.01): RebalancePlan | null {
  if (!val.holdings.length || val.holdings.some(h => h.value === null)) return null;
  const total = val.holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  if (!(total > 0)) return null;
  const trades = val.holdings
    .map(h => {
      const delta = (total * h.targetPct) / 100 - (h.value ?? 0);
      return {referenceAssetId: h.referenceAssetId, symbol: h.symbol, side: delta < 0 ? ('sell' as const) : ('buy' as const), usd: Math.abs(delta), fromPct: h.valuePct ?? 0, toPct: h.targetPct};
    })
    .filter(t => t.usd >= minUsd)
    .sort((a, b) => (a.side === b.side ? b.usd - a.usd || a.referenceAssetId.localeCompare(b.referenceAssetId) : a.side === 'sell' ? -1 : 1));
  const turnoverUsd = trades.filter(t => t.side === 'sell').reduce((s, t) => s + t.usd, 0);
  return {trades, turnoverUsd, feeUsd: turnoverUsd * 2 * 0.0025};
}

/** Next scheduled check for a demo schedule counted from launch: the first boundary launch + k·interval after now. */
export function nextScheduled(launchSeconds: number, intervalSeconds: number, nowSeconds: number): number | null {
  if (intervalSeconds <= 0) return null;
  if (nowSeconds < launchSeconds) return launchSeconds + intervalSeconds;
  return launchSeconds + (Math.floor((nowSeconds - launchSeconds) / intervalSeconds) + 1) * intervalSeconds;
}

export interface SimulatedRebalance {
  /** Unix seconds of the interval boundary. */
  readonly at: number;
  readonly driftBps: number;
  readonly turnoverUsd: number;
}
/**
 * Replay a rebalancing schedule over past prices (demo): starting from the given balances, at every interval boundary
 * value the holdings, and when drift ≥ threshold record a rebalance and reset the simulated balances to the target
 * weights (value kept, minus PancakeSwap fees on the turnover). Boundaries where any price is missing are skipped.
 */
export function simulateRebalances({holdings, priceAt, start, end, intervalSeconds, thresholdBps, feeRate = 0.0025}: {
  holdings: readonly {id: string; units: number; targetPct: number}[];
  priceAt: (id: string, atSeconds: number) => number | null;
  start: number; end: number; intervalSeconds: number; thresholdBps: number; feeRate?: number;
}): SimulatedRebalance[] {
  if (intervalSeconds <= 0 || !holdings.length) return [];
  const units = new Map(holdings.map(h => [h.id, h.units]));
  const events: SimulatedRebalance[] = [];
  for (let t = start + intervalSeconds; t <= end; t += intervalSeconds) {
    const prices = holdings.map(h => priceAt(h.id, t));
    if (prices.some(p => p === null || !(p > 0))) continue;
    const values = holdings.map((h, i) => units.get(h.id)! * prices[i]!);
    const total = values.reduce((s, x) => s + x, 0);
    if (!(total > 0)) continue;
    const driftBps = Math.max(...holdings.map((h, i) => Math.abs((values[i] / total) * 100 - h.targetPct))) * 100;
    if (driftBps < thresholdBps) continue;
    const turnoverUsd = holdings.reduce((s, h, i) => s + Math.max(0, values[i] - (total * h.targetPct) / 100), 0);
    const after = total - turnoverUsd * 2 * feeRate;
    holdings.forEach((h, i) => units.set(h.id, (after * h.targetPct) / 100 / prices[i]!));
    events.push({at: t, driftBps, turnoverUsd});
  }
  return events;
}
