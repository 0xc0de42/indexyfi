import {z} from 'zod';
import {API_BASE_URL, parseAwareIso, type Fetcher} from './api';
import {isDecimal} from './decimal';

/**
 * Typed client for the CoinMarketCap endpoints of the IndexFi server
 * (backend/services/server/src/ind_server/cmc_api.py, documented in backend/docs/CMC_API.md):
 *
 *   GET /v1/cmc/assets   200 {assets}                       | 400 unknown_asset
 *   GET /v1/cmc/quotes   200 {source, quotes}               | 400 unknown_asset | 503 cmc_disabled
 *   GET /v1/cmc/history  200 {source, start, end, series}   | 400 unknown_asset / invalid_date_range | 503 cmc_disabled
 *
 * Requests go through the same `/backend` proxy as Atlas prices; the browser never calls CMC and holds no key.
 * Shapes follow the backend serializer and its real fixtures (lib/fixtures/cmc). Decimals stay exact strings; joins are
 * by canonical asset_id only. CMC data is read-only market reference: not NAV, not an executable price, and for an
 * `underlying_reference` mapping it describes the reference asset, not the BNB wrapper.
 */

const decimal = z.string().refine(isDecimal, 'expected a plain decimal string');
const nullableDecimal = decimal.nullable();
const awareIso = z.string().refine(v => parseAwareIso(v) !== null, 'expected a timezone-aware ISO timestamp');
const utcDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const provenance = z.object({endpoint: z.string(), fetched_at: awareIso}).passthrough();

const mappingWire = z.object({
  asset_id: z.string().min(1),
  cmc_id: z.number().int().positive(),
  kind: z.enum(['crypto', 'rwa']),
  relation: z.enum(['exact_token', 'underlying_reference', 'rwa_aggregate']),
  evidence: z.string(),
});
const quoteWire = z.object({
  cmc_id: z.number().int().positive(),
  kind: z.enum(['crypto', 'rwa']),
  timestamp: awareIso,
  price: nullableDecimal,
  market_cap: nullableDecimal,
  volume_24h: nullableDecimal,
  rank: z.number().int().positive().nullable(),
  tags: z.array(z.string()),
  percent_change_24h: nullableDecimal,
  percent_change_7d: nullableDecimal,
  percent_change_30d: nullableDecimal,
  percent_change_90d: nullableDecimal,
  provenance,
});
const identity = {asset_id: z.string().min(1), symbol: z.string(), mapping: mappingWire.nullable()};
const assetsWire = z.object({assets: z.array(z.object(identity))});
const quotesWire = z.object({
  source: z.string(),
  quotes: z.array(z.object({...identity, status: z.enum(['available', 'pending', 'error']), quote: quoteWire.nullable(), error: z.string().optional()})),
});
const pointWire = z.object({day: utcDay, timestamp: awareIso, price: nullableDecimal, market_cap: nullableDecimal, volume_24h: nullableDecimal, provenance});
const historyWire = z.object({
  source: z.string(),
  start: utcDay,
  end: utcDay,
  series: z.array(z.object({...identity, status: z.enum(['available', 'unavailable', 'error']), points: z.array(pointWire), error: z.string().optional()})),
});
const errorWire = z.object({error: z.enum(['unknown_asset', 'invalid_date_range', 'cmc_disabled'])});

// ---- domain ----------------------------------------------------------------

export type CmcRelation = z.infer<typeof mappingWire>['relation'];
export interface CmcMapping {
  readonly assetId: string;
  readonly cmcId: number;
  readonly kind: 'crypto' | 'rwa';
  readonly relation: CmcRelation;
  readonly evidence: string;
}
export interface CmcQuote {
  readonly cmcId: number;
  /** Provider time of the quote, as sent and as epoch ms. */
  readonly timestamp: string;
  readonly timestampMs: number;
  /** Exact decimal strings (USD), null when CMC omits them. */
  readonly price: string | null;
  readonly marketCap: string | null;
  readonly volume24h: string | null;
  readonly rank: number | null;
  readonly tags: readonly string[];
  /** Percent units as CMC reports them ("1.5" = +1.5%). */
  readonly change24h: string | null;
  readonly change7d: string | null;
  readonly change30d: string | null;
  readonly change90d: string | null;
  readonly fetchedAt: string;
}
export interface CmcQuoteRow {
  readonly assetId: string;
  readonly symbol: string;
  readonly mapping: CmcMapping | null;
  readonly status: 'available' | 'pending' | 'error';
  readonly quote: CmcQuote | null;
  readonly error?: string;
}
export interface CmcPoint {
  /** UTC day, YYYY-MM-DD. */
  readonly day: string;
  readonly t: number;
  readonly price: string | null;
  readonly marketCap: string | null;
  readonly volume24h: string | null;
}
export interface CmcSeries {
  readonly assetId: string;
  readonly symbol: string;
  readonly mapping: CmcMapping | null;
  readonly status: 'available' | 'unavailable' | 'error';
  readonly points: readonly CmcPoint[];
  readonly error?: string;
}
export interface CmcHistory {
  readonly start: string;
  readonly end: string;
  readonly series: readonly CmcSeries[];
}

export type CmcError =
  | {readonly kind: 'unknown_asset'}
  | {readonly kind: 'invalid_date_range'}
  | {readonly kind: 'cmc_disabled'}
  | {readonly kind: 'http'; readonly status: number}
  | {readonly kind: 'unreachable'; readonly message: string}
  | {readonly kind: 'decode'; readonly message: string}
  | {readonly kind: 'aborted'};
export type CmcResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: CmcError};

export function describeCmcError(error: CmcError): string {
  switch (error.kind) {
    case 'unknown_asset': return 'Unknown asset requested from the CMC API.';
    case 'invalid_date_range': return 'Invalid CMC history date range.';
    case 'cmc_disabled': return 'CMC market data is disabled on the server.';
    case 'http': return `CMC API responded with HTTP ${error.status}.`;
    case 'unreachable': return 'CMC API unreachable.';
    case 'decode': return `Unexpected CMC API response: ${error.message}`;
    case 'aborted': return 'Request cancelled.';
  }
}

const toMapping = (m: z.infer<typeof mappingWire> | null): CmcMapping | null =>
  m && {assetId: m.asset_id, cmcId: m.cmc_id, kind: m.kind, relation: m.relation, evidence: m.evidence};
const toQuote = (q: z.infer<typeof quoteWire>): CmcQuote => ({
  cmcId: q.cmc_id, timestamp: q.timestamp, timestampMs: parseAwareIso(q.timestamp) ?? Number.NaN,
  price: q.price, marketCap: q.market_cap, volume24h: q.volume_24h, rank: q.rank, tags: q.tags,
  change24h: q.percent_change_24h, change7d: q.percent_change_7d, change30d: q.percent_change_30d, change90d: q.percent_change_90d,
  fetchedAt: q.provenance.fetched_at,
});

// ---- UTC day ranges ----------------------------------------------------------

export const MAX_CMC_HISTORY_DAYS = 365;
export const utcDayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => utcDayOf(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000);
/** Last `days` completed UTC days: start inclusive, end (today, UTC) exclusive. */
export function lastDays(days: number, nowMs = Date.now()): {start: string; end: string} {
  const end = utcDayOf(nowMs);
  return {start: addDays(end, -days), end};
}
export function validDayRange(start: string, end: string, nowMs = Date.now()): boolean {
  const s = Date.parse(`${start}T00:00:00Z`), e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;
  return (e - s) / 86_400_000 <= MAX_CMC_HISTORY_DAYS && end <= addDays(utcDayOf(nowMs), 1);
}

// ---- transport -------------------------------------------------------------

export interface CmcClientOptions {
  readonly baseUrl?: string;
  readonly fetcher?: Fetcher;
}
const isAbort = (error: unknown, signal?: AbortSignal) => signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');

async function getJson<T>(options: CmcClientOptions, path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<CmcResult<T>> {
  const fetcher: Fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const url = `${(options.baseUrl ?? API_BASE_URL).replace(/\/+$/, '')}${path}`;
  let response: Response;
  try {
    response = await fetcher(url, {method: 'GET', cache: 'no-store', headers: {Accept: 'application/json'}, signal});
  } catch (error) {
    if (isAbort(error, signal)) return {ok: false, error: {kind: 'aborted'}};
    return {ok: false, error: {kind: 'unreachable', message: error instanceof Error ? error.message : String(error)}};
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error, signal)) return {ok: false, error: {kind: 'aborted'}};
    if (response.status >= 500) return {ok: false, error: {kind: 'unreachable', message: `HTTP ${response.status}`}};
    return {ok: false, error: response.ok ? {kind: 'decode', message: 'response is not JSON'} : {kind: 'http', status: response.status}};
  }
  if (!response.ok) {
    const parsed = errorWire.safeParse(body);
    return {ok: false, error: parsed.success ? {kind: parsed.data.error} : {kind: 'http', status: response.status}};
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {ok: false, error: {kind: 'decode', message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid shape'}};
  }
  return {ok: true, value: parsed.data};
}

const withIds = (path: string, ids: readonly string[] = [], extra: Record<string, string> = {}) => {
  const params = new URLSearchParams(extra);
  for (const id of ids) params.append('asset_id', id);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

export function createCmcClient(options: CmcClientOptions = {}) {
  return {
    async assets(signal?: AbortSignal): Promise<CmcResult<readonly CmcMapping[]>> {
      const r = await getJson(options, '/v1/cmc/assets', assetsWire, signal);
      return r.ok ? {ok: true, value: r.value.assets.flatMap(a => (a.mapping ? [toMapping(a.mapping)!] : []))} : r;
    },
    async quotes(assetIds?: readonly string[], signal?: AbortSignal): Promise<CmcResult<readonly CmcQuoteRow[]>> {
      const r = await getJson(options, withIds('/v1/cmc/quotes', assetIds), quotesWire, signal);
      if (!r.ok) return r;
      return {ok: true, value: r.value.quotes.map(q => ({
        assetId: q.asset_id, symbol: q.symbol, mapping: toMapping(q.mapping), status: q.status,
        quote: q.quote ? toQuote(q.quote) : null, ...(q.error ? {error: q.error} : {}),
      }))};
    },
    async history(request: {assetIds: readonly string[]; start: string; end: string}, signal?: AbortSignal): Promise<CmcResult<CmcHistory>> {
      if (!validDayRange(request.start, request.end)) return {ok: false, error: {kind: 'invalid_date_range'}};
      const r = await getJson(options, withIds('/v1/cmc/history', request.assetIds, {start: request.start, end: request.end}), historyWire, signal);
      if (!r.ok) return r;
      return {ok: true, value: {start: r.value.start, end: r.value.end, series: r.value.series.map(s => ({
        assetId: s.asset_id, symbol: s.symbol, mapping: toMapping(s.mapping), status: s.status, ...(s.error ? {error: s.error} : {}),
        points: s.points.map(p => ({day: p.day, t: parseAwareIso(p.timestamp) ?? Date.parse(`${p.day}T00:00:00Z`), price: p.price, marketCap: p.market_cap, volume24h: p.volume_24h})),
      }))}};
    },
  };
}
export type CmcClient = ReturnType<typeof createCmcClient>;
export const cmcApi = createCmcClient();
