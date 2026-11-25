/**
 * In-app links. Assets are addressed by canonical "<chainId>:<address>" ID, never by
 * ticker. Query values are untrusted on the way back in: pages resolve them against
 * the registry/fixtures and ignore anything unknown.
 */

export const WINDOW_LABELS = ['5m', '15m', '1h', '6h', '24h'] as const;
export type WindowLabel = (typeof WINDOW_LABELS)[number];

export const isWindowLabel = (value: unknown): value is WindowLabel => typeof value === 'string' && (WINDOW_LABELS as readonly string[]).includes(value);

export function assetHref(assetId: string, window?: WindowLabel): string {
  const query = new URLSearchParams({asset: assetId});
  if (window) query.set('window', window);
  return `/assets?${query.toString()}`;
}

export function createHref(prefill: {assets?: readonly string[]; from?: string}): string {
  const query = new URLSearchParams();
  if (prefill.from) query.set('from', prefill.from);
  if (prefill.assets?.length) query.set('assets', prefill.assets.join(','));
  const text = query.toString();
  return text ? `/create?${text}` : '/create';
}

export const portfolioHref = (id: string) => `/portfolio/${encodeURIComponent(id)}`;

/** First value of a Next.js search param. */
export const firstParam = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/** Replace the current URL's query without a navigation or a new history entry. */
export function replaceQuery(params: Record<string, string | undefined>): void {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) query.delete(key);
    else query.set(key, value);
  }
  const text = query.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${text ? `?${text}` : ''}`);
}
