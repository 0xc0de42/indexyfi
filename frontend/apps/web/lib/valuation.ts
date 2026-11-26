/**
 * Display valuation of an on-chain vault: actual on-chain holdings priced with the latest Atlas reference prices from
 * the price server (no staleness check, by product decision). Execution always re-prices on chain with fresh signed
 * Atlas prices (*WithPrices); these numbers are for display only. Falls back to the vault's on-chain nav()/AUM when a
 * live reference price is missing.
 */
import {formatUnits} from 'viem';
import type {VaultSnapshot} from './vaults';

export interface HoldingValue {
  readonly referenceAssetId: string;
  readonly symbol: string;
  readonly targetPct: number;
  readonly value: number | null;
  readonly valuePct: number | null;
}
export interface Valuation {
  readonly aum: number | null;
  readonly nav: number | null;
  readonly market: number | null;
  readonly premiumPct: number | null;
  /** Both sides of the PancakeSwap pool, in USD at USD = USDT parity. */
  readonly liquidity: number | null;
  readonly holdings: readonly HoldingValue[];
}

const num = (value: bigint, decimals: number) => Number(formatUnits(value, decimals));

export function valuation(v: VaultSnapshot, prices: ReadonlyMap<string, {price: string}>, settlementDecimals: number): Valuation {
  const values = v.holdings.map(h => {
    const price = prices.get(h.referenceAssetId)?.price;
    return price ? num(h.balance, h.decimals) * Number(price) : null;
  });
  const live = values.every(x => x !== null) ? (values as number[]).reduce((a, b) => a + b, 0) : null;
  const aum = live ?? (v.aum !== null ? num(v.aum, 18) : null);
  const supply = num(v.supply, 18);
  const nav = live !== null && supply > 0 ? live / supply : v.nav !== null ? num(v.nav, 18) : null;
  const market = v.pool?.marketPrice != null ? num(v.pool.marketPrice, 18) : null;
  const premiumPct = market !== null && nav !== null && nav > 0 ? ((market - nav) / nav) * 100 : null;
  const liquidity = v.pool ? 2 * num(v.pool.cash, settlementDecimals) : null;
  const total = live ?? 0;
  return {
    aum, nav, market, premiumPct, liquidity,
    holdings: v.holdings.map((h, i) => ({
      referenceAssetId: h.referenceAssetId, symbol: h.symbol, targetPct: Number(h.weightBps) / 100,
      value: values[i], valuePct: values[i] !== null && total > 0 ? (values[i]! / total) * 100 : null,
    })),
  };
}

/** Sum over vaults, or null if any value is unknown. */
export const total = (xs: readonly (number | null)[]) => (xs.length && xs.every(x => x !== null) ? (xs as number[]).reduce((a, b) => a + b, 0) : xs.length ? null : 0);
