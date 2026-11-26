import {describe, expect, it} from 'vitest';
import {DEFAULT_REBALANCE, driftOf, isValidRebalance, rebalanceStatus, REBALANCE_INTERVALS, REBALANCE_THRESHOLDS_BPS, settingsLabel} from './rebalance';
import {keeperStatus} from './keeper-api';
import {EMPTY_DRAFT, parseDraft, serializeDraft} from './draft';
import type {Fetcher} from './api';
import {parseDeployment} from './vaults';
import manifest97 from '../public/deployments/97.json';

const holding = (id: string, targetPct: number, valuePct: number | null) => ({referenceAssetId: id, symbol: id.toUpperCase(), targetPct, value: valuePct, valuePct});

describe('rebalancing settings', () => {
  it('offers exactly the product options', () => {
    expect(REBALANCE_INTERVALS.map(i => i.seconds)).toEqual([0, 3_600, 10_800, 86_400, 259_200, 604_800]);
    expect([...REBALANCE_THRESHOLDS_BPS]).toEqual([10, 100, 300, 500]);
    expect(isValidRebalance(DEFAULT_REBALANCE)).toBe(true);
    expect(isValidRebalance({intervalSeconds: 7_200, thresholdBps: 100})).toBe(false);
    expect(isValidRebalance({intervalSeconds: 3_600, thresholdBps: 50})).toBe(false);
    expect(settingsLabel({intervalSeconds: 3_600, thresholdBps: 10})).toBe('At most every 1 h, when drift ≥ 0.1%');
    expect(settingsLabel({intervalSeconds: 0, thresholdBps: 100})).toBe('Off');
  });
  it('treats manifests without features as pre-rebalancing (vault 5.1)', () => {
    expect(parseDeployment(manifest97, 97).features.rebalancing).toBe(false);
    expect(parseDeployment({...manifest97, features: {rebalancing: true}}, 97).features.rebalancing).toBe(true);
  });
  it('survives draft storage and falls back to the default for invalid values', () => {
    const saved = parseDraft(serializeDraft({...EMPTY_DRAFT, rebalance: {intervalSeconds: 604_800, thresholdBps: 500}}, 3));
    expect(saved?.draft.rebalance).toEqual({intervalSeconds: 604_800, thresholdBps: 500});
    expect(parseDraft(JSON.stringify({rebalance: {intervalSeconds: 5, thresholdBps: 100}}))?.draft.rebalance).toEqual(DEFAULT_REBALANCE);
    expect(parseDraft(JSON.stringify({name: 'old draft'}))?.draft.rebalance).toEqual(DEFAULT_REBALANCE);
  });
});

describe('drift and eligibility (same rule as the contract)', () => {
  it('is the largest |actual − target| in bps, largest gaps first', () => {
    const d = driftOf({holdings: [holding('a', 50, 52.5), holding('b', 30, 26.4), holding('c', 20, 21.1)]});
    expect(d.driftBps).toBeCloseTo(360);
    expect(d.legs.map(l => l.symbol)).toEqual(['B', 'A', 'C']);
    expect(driftOf({holdings: [holding('a', 50, null), holding('b', 50, 50)]}).driftBps).toBeNull();
  });
  it('requires the interval to pass and drift to reach the threshold', () => {
    const s = {intervalSeconds: 3_600, thresholdBps: 100};
    expect(rebalanceStatus(s, 1_000, 500, 4_599)).toEqual({state: 'cooldown', eligibleAt: 4_600});
    expect(rebalanceStatus(s, 1_000, 99.9, 4_600).state).toBe('below_threshold');
    expect(rebalanceStatus(s, 1_000, 100, 4_600).state).toBe('due');
    expect(rebalanceStatus(s, 1_000, null, 9_999).state).toBe('unknown');
    expect(rebalanceStatus({intervalSeconds: 0, thresholdBps: 10}, 0, 9_999, 9_999)).toEqual({state: 'off', eligibleAt: null});
  });
});

describe('keeper status client (optional backend)', () => {
  const json = (status: number, body: unknown): Fetcher => async () => new Response(JSON.stringify(body), {status});
  const vault = '0x96Ac3e52deA9840B1AbAAabbdA8750b27415b7e3';
  it('reads the documented shape and matches the vault case-insensitively', async () => {
    const body = {updated_at: '2026-11-26T18:00:00Z', vaults: [{vault: vault.toLowerCase(), interval_seconds: 3600, threshold_bps: 100, drift_bps: '37.5', last_rebalance_at: null, next_eligible_at: '2026-11-26T19:00:00Z', last_scan_at: '2026-11-26T18:00:00Z', state: 'below_threshold', last_tx: null, error: null}]};
    const r = await keeperStatus(vault, {fetcher: json(200, body)});
    expect(r.kind === 'ok' && r.status?.state).toBe('below_threshold');
  });
  it('degrades when the keeper is not deployed, disabled, unreachable or malformed', async () => {
    expect(await keeperStatus(vault, {fetcher: json(404, {})})).toEqual({kind: 'unavailable', reason: 'not_deployed'});
    expect(await keeperStatus(vault, {fetcher: json(503, {error: 'keeper_disabled'})})).toEqual({kind: 'unavailable', reason: 'disabled'});
    expect(await keeperStatus(vault, {fetcher: async () => Promise.reject(new TypeError('x'))})).toEqual({kind: 'unavailable', reason: 'unreachable'});
    expect(await keeperStatus(vault, {fetcher: json(200, {vaults: 'x'})})).toEqual({kind: 'unavailable', reason: 'decode'});
  });
});

describe('rebalance preview (demo)', async () => {
  const {rebalancePlan} = await import('./rebalance');
  const h = (id: string, targetPct: number, value: number | null, valuePct: number | null) => ({referenceAssetId: id, symbol: id.toUpperCase(), targetPct, value, valuePct});
  it('sells the overweight and buys the underweight back to target, sells first', () => {
    const plan = rebalancePlan({holdings: [h('a', 50, 600, 60), h('b', 30, 250, 25), h('c', 20, 150, 15)]})!;
    expect(plan.trades.map(t => `${t.side}:${t.symbol}:${t.usd}`)).toEqual(['sell:A:100', 'buy:B:50', 'buy:C:50']);
    expect(plan.turnoverUsd).toBe(100);
    expect(plan.feeUsd).toBeCloseTo(0.5);
  });
  it('needs a price for every holding', () => {
    expect(rebalancePlan({holdings: [h('a', 50, null, null), h('b', 50, 10, 100)]})).toBeNull();
  });
});

describe('demo schedule and simulated history', async () => {
  const {nextScheduled, simulateRebalances} = await import('./rebalance');
  it('finds the next boundary counted from launch', () => {
    expect(nextScheduled(1_000, 3_600, 1_000 + 3_600 * 2 + 10)).toBe(1_000 + 3_600 * 3);
    expect(nextScheduled(1_000, 3_600, 500)).toBe(4_600);
    expect(nextScheduled(1_000, 0, 5_000)).toBeNull();
  });
  it('rebalances when drift reaches the threshold, then measures drift from the reset holdings', () => {
    // A doubles in price at t=2h; B stays flat. 50/50 target.
    const price = (id: string, t: number) => (id === 'a' ? (t >= 7_200 ? 2 : 1) : 1);
    const events = simulateRebalances({holdings: [{id: 'a', units: 50, targetPct: 50}, {id: 'b', units: 50, targetPct: 50}], priceAt: price, start: 0, end: 4 * 3_600, intervalSeconds: 3_600, thresholdBps: 100});
    expect(events).toHaveLength(1);
    expect(events[0].at).toBe(7_200);
    expect(events[0].driftBps).toBeCloseTo(1_666.67, 1); // 66.67% vs 50%
    expect(events[0].turnoverUsd).toBeCloseTo(25);
    expect(simulateRebalances({holdings: [{id: 'a', units: 1, targetPct: 100}], priceAt: () => null, start: 0, end: 7_200, intervalSeconds: 3_600, thresholdBps: 10})).toEqual([]);
  });
});
