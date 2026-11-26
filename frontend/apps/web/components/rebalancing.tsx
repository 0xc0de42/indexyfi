'use client';
import {useQuery} from '@tanstack/react-query';
import {useEffect, useMemo, useState} from 'react';
import type {Address} from 'viem';
import {Badge, Button, Card, Metric} from '@indexfi/ui';
import {usePublicClient} from 'wagmi';
import {KEEPER_STATE_LABEL, keeperStatus} from '@/lib/keeper-api';
import {bpsLabel, driftOf, rebalanceStatus, relativeTime, settingsLabel, type RebalanceState} from '@/lib/rebalance';
import {useVaultTransaction} from '@/lib/use-vaults';
import {feedIdsFor, readIndexRule, readRebalance, rebalanceAbi, rebalanceHistory, signedPrices, units, type Deployment, type VaultSnapshot} from '@/lib/vaults';
import {referenceAssets, referenceCategories} from '@/lib/catalog';
import {useCmcState} from '@/lib/cmc';
import {reconstitutionPreview, ruleLabel, selectIndex} from '@/lib/index-rule';
import type {Valuation} from '@/lib/valuation';

const STATE_TEXT: Record<RebalanceState, string> = {
  off: 'Rebalancing off', cooldown: 'Waiting for the interval', below_threshold: 'Within threshold', due: 'Due for rebalancing', unknown: 'Waiting for prices',
};
const nowSeconds = () => Math.floor(Date.now() / 1000);
const when = (s: number) => new Date(s * 1000).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});

/**
 * Rebalancing on the portfolio page. Drift is computed here from on-chain holdings × Atlas prices (works for every
 * vault); settings, schedule, history and "Rebalance now" come from vault 5.2+, keeper status from the backend. Each part
 * degrades on its own when its source is not deployed yet.
 */
export function Rebalancing({d, v, val}: {d: Deployment; v: VaultSnapshot; val: Valuation | null}) {
  const client = usePublicClient({chainId: d.chainId});
  const transaction = useVaultTransaction(d);
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => { const id = setInterval(() => setNow(nowSeconds()), 15_000); return () => clearInterval(id); }, []);
  const config = useQuery({queryKey: ['rebalance-config', v.address], enabled: !!client, queryFn: () => readRebalance(client!, v.address as Address), refetchInterval: 30_000});
  const history = useQuery({
    queryKey: ['rebalance-history', v.address], enabled: !!client && !!config.data,
    queryFn: () => rebalanceHistory(client!, v.address as Address, BigInt(d.deploymentBlock)), refetchInterval: 60_000,
  });
  const keeper = useQuery({queryKey: ['keeper-status', v.address], enabled: !!config.data, queryFn: () => keeperStatus(v.address), refetchInterval: 30_000, retry: false});
  const [quoteError, setQuoteError] = useState('');
  // Index rule (5.2+): what the next reconstitution would change, from live CMC market caps.
  const rule = useQuery({queryKey: ['index-rule', v.address], enabled: !!client && !!config.data, queryFn: () => readIndexRule(client!, v.address as Address, referenceCategories), staleTime: Infinity});
  const cmc = useCmcState();
  const preview = useMemo(() => {
    if (!rule.data) return null;
    const executable = new Set(d.assets.map(a => a.referenceAssetId));
    const sel = selectIndex(referenceAssets.filter(a => executable.has(a.id)), rule.data, a => cmc.rows.get(a.id)?.quote?.marketCap);
    return sel.constituents.length ? reconstitutionPreview(v.holdings.map(h => h.referenceAssetId), sel) : null;
  }, [rule.data, d.assets, cmc.rows, v.holdings]);
  const symbolOf = (id: string) => v.holdings.find(h => h.referenceAssetId === id)?.symbol ?? id;

  const drift = val ? driftOf(val) : {driftBps: null, legs: []};
  const settings = config.data ? {intervalSeconds: config.data.intervalSeconds, thresholdBps: config.data.thresholdBps} : null;
  const status = settings && config.data ? rebalanceStatus(settings, config.data.lastRebalanceAt, drift.driftBps, now) : null;
  const scale = Math.max(settings?.thresholdBps ?? 100, drift.driftBps ?? 0) * 1.25;

  async function rebalanceNow() {
    if (!client) return;
    setQuoteError('');
    try {
      const prices = await signedPrices(d, feedIdsFor(d, v.holdings.map(h => h.address as Address)));
      const {result} = await client.simulateContract({address: v.address as Address, abi: rebalanceAbi, functionName: 'quoteRebalanceWithPrices', args: [prices.payloads, prices.signatures]});
      const [, due, expectedOut] = result;
      if (!due) { setQuoteError('The vault reports the rebalance is not due yet.'); return; }
      if (await transaction.submit({kind: 'rebalance', vault: v.address as Address, expectedOut}, 100)) { await config.refetch(); await history.refetch(); }
    } catch (err) {
      setQuoteError(err instanceof Error ? err.message.split('\n')[0] : 'Rebalance quote failed');
    }
  }

  return (
    <Card data-testid="rebalancing">
      <div className="card-heading">
        <h2>Rebalancing</h2>
        {config.isLoading ? <Badge>Checking vault</Badge>
          : !settings ? <Badge>{d.provider === 'flap' ? 'Not available · Flap' : 'Not enabled · vault 5.1'}</Badge>
          : <Badge tone={status?.state === 'due' ? 'warn' : status?.state === 'off' ? 'neutral' : 'good'}>{STATE_TEXT[status!.state]}</Badge>}
      </div>

      <div className="price-metrics">
        <Metric label="Current drift" value={<span className="rebalance-drift">{drift.driftBps === null ? '—' : bpsLabel(Math.round(drift.driftBps))}</span>} detail="largest weight gap, Atlas prices" />
        <Metric label="Settings" value={settings ? (settings.intervalSeconds === 0 ? 'Off' : `${bpsLabel(settings.thresholdBps)} · ${settingsLabel(settings).split(',')[0].replace('At most every ', 'every ')}`) : '—'} detail={settings ? 'threshold · minimum interval' : 'set at launch on vault 5.2'} />
        {settings && config.data && settings.intervalSeconds > 0 && (
          <Metric label="Next eligible" value={status?.eligibleAt == null ? '—' : status.eligibleAt <= now ? 'Now' : relativeTime(status.eligibleAt, now)} detail={status?.eligibleAt ? when(status.eligibleAt) : undefined} />
        )}
      </div>
      {drift.driftBps !== null && (
        <div className="drift-bar" data-due={status?.state === 'due'} aria-label={`Drift ${bpsLabel(Math.round(drift.driftBps))}${settings ? ` of ${bpsLabel(settings.thresholdBps)} threshold` : ''}`}>
          <span style={{width: `${Math.min(100, (drift.driftBps / scale) * 100)}%`}} />
          {settings && settings.intervalSeconds > 0 && <i style={{left: `${(settings.thresholdBps / scale) * 100}%`}} title={`Threshold ${bpsLabel(settings.thresholdBps)}`} />}
        </div>
      )}
      {drift.legs.length > 0 && (
        <div className="rebalance-legs" aria-label="Largest weight gaps">
          {drift.legs.slice(0, 3).map(l => (
            <span key={l.referenceAssetId} style={{display: 'contents'}}>
              <strong>{l.symbol}</strong>
              <span className="muted">target {l.targetPct.toFixed(2)}% → actual {l.actualPct.toFixed(2)}%</span>
              <span className={l.diffPct < 0 ? 'negative' : 'positive'}>{l.diffPct > 0 ? '+' : ''}{l.diffPct.toFixed(2)} pp</span>
            </span>
          ))}
        </div>
      )}

      {!config.isLoading && !settings && (
        <p className="fine-print">{d.provider === 'flap'
          ? 'Flap vaults are not rebalanced (the vault has no contract space for it), so weights drift with prices.'
          : 'This vault was launched before rebalancing (vault 5.1), so its weights drift with prices and are not rebalanced. Portfolios launched on vault 5.2 store an interval and a drift threshold and are rebalanced automatically.'}</p>
      )}

      {settings && config.data && (
        <>
          {rule.data && (
            <p className="fine-print" data-testid="index-rule-status">
              Index rule: {ruleLabel(rule.data)}, re-selected at each rebalance.
              {preview && (preview.add.length || preview.remove.length
                ? <> If reconstituted now: add {preview.add.map(a => a.symbol).join(', ') || 'none'}; remove {preview.remove.map(symbolOf).join(', ') || 'none'}.</>
                : <> The current holdings match today&apos;s top {rule.data.size}.</>)}
            </p>
          )}
          <p className="fine-print">
            Last rebalance: {history.data?.length ? when(history.data[0].at) : `none yet (launch ${when(config.data.lastRebalanceAt)})`}
            {keeper.data?.kind === 'ok' && keeper.data.status
              ? <> · Keeper: {KEEPER_STATE_LABEL[keeper.data.status.state]}{keeper.data.status.last_scan_at ? `, last scan ${relativeTime(Date.parse(keeper.data.status.last_scan_at) / 1000, now)}` : ''}{keeper.data.status.error ? ` (${keeper.data.status.error})` : ''}</>
              : keeper.data ? <> · Keeper status unavailable{keeper.data.kind === 'unavailable' && keeper.data.reason === 'disabled' ? ' (keeper disabled)' : ''}</> : null}
          </p>
          {status?.state === 'due' && (
            <div className="wizard-actions">
              <span className="fine-print">Anyone can trigger a due rebalance; the vault enforces the rules and a 1% NAV-loss cap.</span>
              <Button type="button" variant="secondary" disabled={!transaction.ready || !!transaction.pending} onClick={() => void rebalanceNow()}>Rebalance now</Button>
            </div>
          )}
          {(quoteError || transaction.error) && <div role="alert" className="notice notice--bad">{quoteError || transaction.error}</div>}
          {transaction.pending && <div role="status" className="notice notice--neutral">{transaction.pending}</div>}
          {history.data && history.data.length > 0 && (
            <ul className="rebalance-history" aria-label="Rebalance history">
              {history.data.slice(0, 5).map(e => (
                <li key={e.tx}>
                  {when(e.at)} · drift {bpsLabel(e.driftBps)} · NAV {units(e.navBefore, 18)} → {units(e.navAfter, 18)} · <code title={e.tx}>{e.tx.slice(0, 10)}…</code>
                </li>
              ))}
            </ul>
          )}
          {history.data === null && <p className="fine-print">Rebalance history unavailable from this RPC.</p>}
        </>
      )}
    </Card>
  );
}
