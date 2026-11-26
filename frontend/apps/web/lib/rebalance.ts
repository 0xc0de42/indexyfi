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
