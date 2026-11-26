/**
 * Fixed IndexFi launch parameters, enforced by the frontend and the operator launch script (no contract change).
 *
 * Trading unlock: an IndexFi milestone of $10,000 AUM, the same for both venues. Below it the app offers primary deposit
 * and redemption at NAV; at or above it, and only while the secondary market is operational (lib/venue.ts), it shows
 * PancakeSwap buy, sell and liquidity. The unlock is dynamic: it re-locks if AUM falls back below the milestone.
 */
export const LAUNCH = {
  /** USDT invested in the constituents at launch; backs the creator's tokens. */
  collateralUSDT: 1_000,
  /** Settlement the vault reserves for the PancakeSwap pool, paired with the same number of tokens at $1. Not collateral. */
  poolReserveUSDT: 100,
  startNav: 1,
  /** AUM (USD) of the trading unlock milestone. */
  tradingUnlockUSD: 10_000,
} as const;

export const launchTotalUSDT = LAUNCH.collateralUSDT + LAUNCH.poolReserveUSDT;

export interface Milestone {
  readonly reached: boolean;
  /** 0–100, capped. */
  readonly progressPct: number;
}

/** Progress to the trading unlock milestone from AUM in USD. Unknown AUM counts as not reached. */
export function unlockMilestone(aum: number | null): Milestone {
  if (aum === null || !Number.isFinite(aum)) return {reached: false, progressPct: 0};
  return {reached: aum >= LAUNCH.tradingUnlockUSD, progressPct: Math.min(100, Math.max(0, (aum / LAUNCH.tradingUnlockUSD) * 100))};
}
