/**
 * Venue boundary for the shared OpenFour / Flap workflow. Components consume these normalized values instead of
 * branching on the venue: settlement label, launch notice, external-trading notice, the trading lifecycle and readable
 * errors. Contract arguments and execution stay in lib/use-vaults.ts; tax-aware quoting in lib/flap-quote.ts.
 */
import {FUNDING_TOKEN} from '@/domain/model';
import {flapErrorMessage} from './flap';
import {unlockMilestone} from './launch';
import type {Deployment, VaultSnapshot} from './vaults';

export interface VenuePresentation {
  readonly venueName: 'OpenFour' | 'Flap';
  /** Settlement token label for amounts, approvals, funding, quotes and minimums. */
  readonly settlementLabel: string;
  /** What the creator's wallet is asked for at launch; null when there is nothing beyond the transaction. */
  readonly launchAuthorizationNotice: string | null;
  /** Shown near trading controls when the market can be traded outside IndexFi before the unlock. */
  readonly externalTradingNotice: string | null;
}

export function venuePresentation(d: Pick<Deployment, 'provider' | 'fixture'>): VenuePresentation {
  if (d.provider === 'flap') {
    return {
      venueName: 'Flap', settlementLabel: 'Flap USD',
      launchAuthorizationNotice: 'Your wallet approves Flap USD, then confirms the launch. The token address is prepared automatically; no signature is needed.',
      externalTradingNotice: 'The PancakeSwap pool exists from launch and can be traded outside IndexFi before the trading unlock.',
    };
  }
  return {
    venueName: 'OpenFour', settlementLabel: FUNDING_TOKEN,
    launchAuthorizationNotice: d.fixture ? null : 'Your wallet will ask for two approvals: a signature authorizing the OpenFour launch, then the launch transaction.',
    externalTradingNotice: null,
  };
}

export interface TradingLifecycle {
  /** AUM has reached the $10,000 trading unlock milestone (dynamic: re-locks if AUM falls back). */
  readonly milestoneReached: boolean;
  /** The vault is migrated, not closed, and has a pair with funded reserves. */
  readonly secondaryMarketReady: boolean;
  readonly progressPct: number;
}

export function tradingLifecycle(v: Pick<VaultSnapshot, 'closed' | 'phase' | 'pair' | 'pool'>, aum: number | null): TradingLifecycle {
  const m = unlockMilestone(aum);
  const pairSet = !!v.pair && !/^0x0{40}$/i.test(v.pair);
  const reserves = !!v.pool && v.pool.cash > 0n && v.pool.shares > 0n;
  return {milestoneReached: m.reached, secondaryMarketReady: !v.closed && v.phase === 3 && pairSet && reserves, progressPct: m.progressPct};
}

export const canTrade = (s: TradingLifecycle) => s.milestoneReached && s.secondaryMarketReady;

export type TradingState = 'locked' | 'pending_market' | 'unlocked';
export function tradingState(s: TradingLifecycle): TradingState {
  return !s.milestoneReached ? 'locked' : s.secondaryMarketReady ? 'unlocked' : 'pending_market';
}
export const TRADING_STATE_LABEL: Record<TradingState, string> = {
  locked: 'Primary market', pending_market: 'Unlock pending: market not ready', unlocked: 'Trading unlocked',
};

/** Readable messages for vault quote and transaction failures on either venue; unknown messages pass through. */
const SHARED_ERRORS: readonly [RegExp, string][] = [
  [/StalePrice/, 'The on-chain oracle price is older than its limit. Fresh signed Atlas prices are posted with the transaction; try again.'],
  [/InvalidSigner|InvalidPayload|FutureTimestamp|InvalidPrice/, 'The signed Atlas prices were rejected. Try again with fresh prices.'],
  [/Slippage/i, 'Prices moved beyond the slippage limit. Try again, or raise the slippage tolerance.'],
  [/insufficient allowance/i, 'The token approval is too small. Approve again and retry.'],
  [/transfer amount exceeds balance|insufficient balance/i, 'This wallet does not hold enough of the token for this amount.'],
];
export function vaultErrorMessage(d: Pick<Deployment, 'provider'>, message: string): string {
  const lines = message.split('\n');
  const key = lines.find(l => /0x[0-9a-f]{8}|Flap:|Invalid|Slippage|Inactive|Insufficient|StalePrice|allowance|balance/i.test(l)) ?? lines[0];
  if (d.provider === 'flap') {
    const flap = flapErrorMessage(key);
    if (flap !== key) return flap;
  }
  return SHARED_ERRORS.find(([re]) => re.test(key))?.[1] ?? key;
}

/** Share of a deposit lost to price impact and fees: 1 − value of the quoted shares at NAV / amount in. */
export function depositImpactPct(amountUsd: number, shares: number, nav: number | null): number | null {
  if (!(amountUsd > 0) || !(shares > 0) || !nav || !(nav > 0)) return null;
  return Math.max(0, (1 - (shares * nav) / amountUsd) * 100);
}
/** Above this, the deposit preview shows a non-blocking price-impact warning (contracts keep their own limits). */
export const DEPOSIT_IMPACT_WARNING_PCT = 2;
