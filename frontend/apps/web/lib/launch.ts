/**
 * Fixed IndexFi launch parameters (option A: enforced by the frontend and the operator launch script, not by the
 * contracts). On chain 97 only the operator can launch, since OpenFour requires the Core signer's signature.
 *
 * The contracts still require a USDT pool reserve at launch and open the PancakeSwap pool in the launch transaction.
 * "Graduation" is a display state: below the threshold the app offers primary deposit and redemption at NAV only; at or
 * above it the app shows the PancakeSwap market (buy, sell, liquidity).
 */
export const LAUNCH = {
  /** USDT invested in the constituents at launch; backs the creator's tokens. */
  collateralUSDT: 1_000,
  /** USDT the vault reserves for the PancakeSwap pool, paired with the same number of tokens at $1. Not collateral. */
  poolReserveUSDT: 100,
  startNav: 1,
  /** AUM (USD) at which the app opens PancakeSwap trading. */
  graduationUSD: 10_000,
} as const;

export const launchTotalUSDT = LAUNCH.collateralUSDT + LAUNCH.poolReserveUSDT;

export interface Graduation {
  readonly graduated: boolean;
  /** 0–100, capped. */
  readonly progressPct: number;
}

/** Graduation from AUM in USD. Unknown AUM counts as not graduated. */
export function graduation(aum: number | null): Graduation {
  if (aum === null || !Number.isFinite(aum)) return {graduated: false, progressPct: 0};
  return {graduated: aum >= LAUNCH.graduationUSD, progressPct: Math.min(100, Math.max(0, (aum / LAUNCH.graduationUSD) * 100))};
}
