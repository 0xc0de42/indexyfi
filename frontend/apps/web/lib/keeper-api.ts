import {z} from 'zod';
import {API_BASE_URL, parseAwareIso, type Fetcher} from './api';

/**
 * Read-only status of the rebalance keeper (docs/rebalancing/IMPLEMENTATION_PLAN.md §3.4):
 *   GET /v1/rebalancer/status?vault=0x…  200 {updated_at, vaults} | 503 keeper_disabled | 404 before the keeper ships
 * Optional: the portfolio page works without it (drift, schedule and history come from chain + Atlas).
 */
const iso = z.string().refine(v => parseAwareIso(v) !== null).nullable();
const statusWire = z.object({
  updated_at: z.string().refine(v => parseAwareIso(v) !== null),
  vaults: z.array(z.object({
    vault: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    interval_seconds: z.number().int().nonnegative(),
    threshold_bps: z.number().int().nonnegative(),
    drift_bps: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
    last_rebalance_at: iso,
    next_eligible_at: iso,
    last_scan_at: iso,
    state: z.enum(['disabled', 'waiting', 'below_threshold', 'due', 'submitted', 'failed']),
    last_tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
    error: z.string().nullable(),
  })),
});
export type KeeperVaultStatus = z.infer<typeof statusWire>['vaults'][number];
export type KeeperResult =
  | {readonly kind: 'ok'; readonly status: KeeperVaultStatus | null; readonly updatedAt: string}
  | {readonly kind: 'unavailable'; readonly reason: 'not_deployed' | 'disabled' | 'unreachable' | 'decode'};

export async function keeperStatus(vault: string, options: {baseUrl?: string; fetcher?: Fetcher; signal?: AbortSignal} = {}): Promise<KeeperResult> {
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const url = `${(options.baseUrl ?? API_BASE_URL).replace(/\/+$/, '')}/v1/rebalancer/status?vault=${encodeURIComponent(vault)}`;
  let response: Response;
  try {
    response = await fetcher(url, {method: 'GET', cache: 'no-store', headers: {Accept: 'application/json'}, signal: options.signal});
  } catch {
    return {kind: 'unavailable', reason: 'unreachable'};
  }
  if (response.status === 404) return {kind: 'unavailable', reason: 'not_deployed'};
  if (response.status === 503) return {kind: 'unavailable', reason: 'disabled'};
  if (!response.ok) return {kind: 'unavailable', reason: 'unreachable'};
  const parsed = statusWire.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return {kind: 'unavailable', reason: 'decode'};
  const row = parsed.data.vaults.find(v => v.vault.toLowerCase() === vault.toLowerCase()) ?? null;
  return {kind: 'ok', status: row, updatedAt: parsed.data.updated_at};
}

export const KEEPER_STATE_LABEL: Record<KeeperVaultStatus['state'], string> = {
  disabled: 'Off for this vault', waiting: 'Waiting for the interval', below_threshold: 'Drift below threshold',
  due: 'Due: rebalancing next scan', submitted: 'Rebalance submitted', failed: 'Last attempt failed',
};
