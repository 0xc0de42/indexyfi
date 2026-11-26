import type {RegistryAsset} from '../data/registry.generated';

/** Chain-56 reference asset with its verified Atlas feed. Prices live in the price store, not here. */
export type Asset = RegistryAsset & {readonly color: string};

/**
 * Portfolio as displayed. Until contracts are integrated (Phase III) every portfolio
 * is a labelled fixture: its NAV, market, AUM, volume and progress values are
 * illustrative, never computed from live prices.
 */
export interface Portfolio {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  readonly description: string;
  readonly category: string;
  readonly allocations: readonly {readonly asset: Asset; readonly weight: number}[];
  readonly source: 'fixture';
  readonly reference: number | null;
  readonly marketPrice: number | null;
  readonly return30d: number | null;
  readonly volume: number | null;
  readonly liquidity: number | null;
  readonly aum: number | null;
  readonly supply: number | null;
  readonly creator: string | null;
  readonly createdAt: string;
  readonly phase: 'launch' | 'graduated';
  readonly progress: number | null;
  readonly creatorFeeBps: number | null;
  readonly tokenAddress?: string;
  readonly vaultAddress?: string;
  readonly venue: string;
  readonly paused: boolean;
}

export type Side = 'buy' | 'sell';
export type Draft = {name: string; symbol: string; description: string; category: string; allocations: {asset: Asset; weight: number}[]; funding: number; liquidity: number};

/** Settlement and funding token. USD reference prices assume USD/USDT parity. */
export const FUNDING_TOKEN = 'USDT';
export const categories = ['Crypto', 'DeFi', 'RWA', 'Thematic', 'Stablecoins', 'Mixed'];

export const usd = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits}).format(v);
export const compact = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1}).format(v);
export const percent = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

/** Render an exact decimal price string; conversion to number happens only here, for display. */
export function formatPrice(price: string | null | undefined): string {
  if (price == null) return '—';
  const value = Number(price);
  if (!Number.isFinite(value)) return '—';
  const digits = value >= 1 ? 2 : value >= 0.01 ? 4 : value > 0 ? Math.min(12, 2 - Math.floor(Math.log10(value)) + 2) : 2;
  return usd(value, digits);
}

/** Seconds between a Unix-seconds source timestamp and the browser clock. */
export function ageLabel(sourceTimestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round(now / 1000 - sourceTimestamp));
  if (seconds < 120) return `${seconds}s ago`;
  if (seconds < 7_200) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3_600)}h ago`;
}
