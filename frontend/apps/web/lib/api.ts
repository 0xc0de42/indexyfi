import {z} from 'zod';

/**
 * Typed client for the IndexFi price server (backend/services/server/src/ind_server/api.py).
 *
 *   GET /snapshot  200 SnapshotWire | 503 {"error":"not_initialized"}
 *   GET /history   200 HistoryWire  | 400 {"error":"invalid_time_range"} | 500 {"error":"history_read_failed"}
 *
 * The browser never talks to Atlas. By default requests go to the same-origin Next.js
 * proxy (`/backend/*` → PYTHON_API_URL), so no CORS configuration is needed;
 * NEXT_PUBLIC_INDEXFI_API_URL may point straight at the server instead, in which case
 * the page origin must equal `server.frontend_origin` in backend/config.toml.
 *
 * Wire snake_case is converted to domain camelCase here and nowhere else. Prices stay
 * exact decimal strings.
 */

export const API_BASE_URL = (process.env.NEXT_PUBLIC_INDEXFI_API_URL || '/backend').replace(/\/+$/, '');
/** Shared server/client limit: at most 24 hours per request. */
export const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_HISTORY_MS = 5 * 60 * 1000;

// ---- wire schema -----------------------------------------------------------

const DECIMAL = /^\d+(\.\d+)?$/;
const ISO_AWARE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** Parse a timezone-aware ISO 8601 timestamp (`Z` or `±HH:MM`, optional fraction) to epoch ms. */
export function parseAwareIso(value: string): number | null {
  const match = ISO_AWARE.exec(value);
  if (!match) return null;
  const [, base, fraction = '', zone] = match;
  const millis = fraction.padEnd(3, '0').slice(0, 3);
  const ms = Date.parse(`${base}.${millis}${zone}`);
  return Number.isFinite(ms) ? ms : null;
}

const assetPriceWire = z.object({
  asset_id: z.string().min(1),
  feed_id: z.number().int().positive(),
  price: z.string().regex(DECIMAL, 'price must be a plain decimal string'),
  source_timestamp: z.number().int().nonnegative(),
});
const snapshotWire = z.object({
  snapshot_at: z.string().refine(value => parseAwareIso(value) !== null, 'snapshot_at must be timezone-aware ISO 8601'),
  prices: z.array(assetPriceWire),
});
const historyWire = z.object({snapshots: z.array(snapshotWire)});
const apiErrorWire = z.object({
  error: z.enum(['not_initialized', 'invalid_time_range', 'history_read_failed']),
});

export type AssetPriceWire = z.infer<typeof assetPriceWire>;
export type SnapshotWire = z.infer<typeof snapshotWire>;
export type HistoryWire = z.infer<typeof historyWire>;
export type ApiErrorWire = z.infer<typeof apiErrorWire>;

// ---- domain ----------------------------------------------------------------

export interface AssetPrice {
  readonly assetId: string;
  readonly feedId: number;
  /** Exact decimal string, USD reference price. */
  readonly price: string;
  /** Atlas source time, Unix seconds. */
  readonly sourceTimestamp: number;
}
export interface PriceSnapshot {
  /** Server sample time as sent (not the oracle update time). */
  readonly snapshotAt: string;
  readonly snapshotAtMs: number;
  readonly prices: readonly AssetPrice[];
}

export type ApiError =
  | {readonly kind: 'not_initialized'}
  | {readonly kind: 'invalid_time_range'}
  | {readonly kind: 'history_read_failed'}
  | {readonly kind: 'http'; readonly status: number}
  | {readonly kind: 'unreachable'; readonly message: string}
  | {readonly kind: 'decode'; readonly message: string}
  | {readonly kind: 'aborted'};

export type Result<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: ApiError};

const ok = <T>(value: T): Result<T> => ({ok: true, value});
const err = <T>(error: ApiError): Result<T> => ({ok: false, error});

function toSnapshot(wire: SnapshotWire): PriceSnapshot {
  return {
    snapshotAt: wire.snapshot_at,
    // Refined above, so never null here.
    snapshotAtMs: parseAwareIso(wire.snapshot_at) ?? Number.NaN,
    prices: wire.prices.map(p => ({assetId: p.asset_id, feedId: p.feed_id, price: p.price, sourceTimestamp: p.source_timestamp})),
  };
}

export function describeApiError(error: ApiError): string {
  switch (error.kind) {
    case 'not_initialized':
      return 'Price server is starting: waiting for the first complete sample.';
    case 'invalid_time_range':
      return 'Invalid history time range.';
    case 'history_read_failed':
      return 'Price server could not read stored history.';
    case 'http':
      return `Price server responded with HTTP ${error.status}.`;
    case 'unreachable':
      return 'Price server unreachable.';
    case 'decode':
      return `Unexpected response from price server: ${error.message}`;
    case 'aborted':
      return 'Request cancelled.';
  }
}

// ---- transport -------------------------------------------------------------

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetcher?: Fetcher;
}

export interface HistoryRequest {
  /** Inclusive. */
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
  /** Empty means all assets. */
  readonly assetIds?: readonly string[];
}

export function historyPath(request: HistoryRequest): string {
  const params = new URLSearchParams();
  params.set('start', request.start.toISOString());
  params.set('end', request.end.toISOString());
  for (const id of request.assetIds ?? []) params.append('asset_id', id);
  return `/history?${params.toString()}`;
}

export function validateHistoryRange(start: Date, end: Date): boolean {
  const duration = end.getTime() - start.getTime();
  return Number.isFinite(duration) && duration > 0 && duration <= MAX_HISTORY_MS;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}

async function getJson<T>(
  options: ApiClientOptions,
  path: string,
  schema: z.ZodType<T>,
  expected: ReadonlySet<ApiErrorWire['error']>,
  signal?: AbortSignal,
): Promise<Result<T>> {
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const url = `${(options.baseUrl ?? API_BASE_URL).replace(/\/+$/, '')}${path}`;
  let response: Response;
  try {
    response = await fetcher(url, {method: 'GET', cache: 'no-store', headers: {Accept: 'application/json'}, signal});
  } catch (error) {
    if (isAbort(error, signal)) return err({kind: 'aborted'});
    return err({kind: 'unreachable', message: error instanceof Error ? error.message : String(error)});
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error, signal)) return err({kind: 'aborted'});
    // A proxy that cannot reach the server answers with a non-JSON 5xx page.
    if (response.status >= 500) return err({kind: 'unreachable', message: `HTTP ${response.status}`});
    return err(response.ok ? {kind: 'decode', message: 'response is not JSON'} : {kind: 'http', status: response.status});
  }
  if (!response.ok) {
    const parsed = apiErrorWire.safeParse(body);
    if (parsed.success && expected.has(parsed.data.error)) return err({kind: parsed.data.error});
    return err({kind: 'http', status: response.status});
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err({kind: 'decode', message: parsed.error.issues[0]?.message ?? 'invalid shape'});
  return ok(parsed.data);
}

export function createApiClient(options: ApiClientOptions = {}) {
  return {
    async snapshot(signal?: AbortSignal): Promise<Result<PriceSnapshot>> {
      const result = await getJson(options, '/snapshot', snapshotWire, new Set(['not_initialized']), signal);
      return result.ok ? ok(toSnapshot(result.value)) : result;
    },
    async history(request: HistoryRequest, signal?: AbortSignal): Promise<Result<readonly PriceSnapshot[]>> {
      if (!validateHistoryRange(request.start, request.end)) return err({kind: 'invalid_time_range'});
      const result = await getJson(
        options,
        historyPath(request),
        historyWire,
        new Set(['invalid_time_range', 'history_read_failed']),
        signal,
      );
      return result.ok ? ok(result.value.snapshots.map(toSnapshot)) : result;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
export const api = createApiClient();
