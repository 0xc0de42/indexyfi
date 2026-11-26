import {LAUNCH} from '@/lib/launch';
import {compact} from '@/domain/model';
import {tradingState, type TradingLifecycle} from '@/lib/venue';

/** AUM progress toward the shared $10,000 trading unlock, and whether the market is operational once it is reached. */
export function TradingUnlockBar({s, aum, detail = true}: {s: TradingLifecycle; aum: number | null; detail?: boolean}) {
  const state = tradingState(s);
  return (
    <div className="graduation" data-testid="trading-unlock" data-state={state} data-graduated={state === 'unlocked'}>
      <div className="graduation__track" role="progressbar" aria-label="Trading unlock progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progressPct)}>
        <span style={{width: `${s.progressPct}%`}} />
      </div>
      {detail && (
        <small>
          {state === 'unlocked'
            ? `Trading unlocked · AUM ${compact(aum)}`
            : state === 'pending_market'
              ? `Milestone reached (AUM ${compact(aum)}) · market not operational yet`
              : `${compact(aum)} of ${compact(LAUNCH.tradingUnlockUSD)} AUM · ${s.progressPct.toFixed(1)}% to trading unlock`}
        </small>
      )}
    </div>
  );
}
