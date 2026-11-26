'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {isAddress, type Address} from 'viem';
import {useAccount, useSwitchChain} from 'wagmi';
import {useQuery} from '@tanstack/react-query';
import {Check, ArrowRight, ArrowLeft, X, RotateCcw, Pencil} from 'lucide-react';
import {Button, Card, Badge, Empty} from '@indexfi/ui';
import {referenceAssetById, referenceAssets} from '@/lib/catalog';
import {usePriceState} from '@/lib/prices';
import {draftIssues, equalWeights} from '@/domain/policy';
import {addItem, isEqualSplit, normalize, removeItem, totalOf} from '@/domain/allocation';
import {suggestTicker} from '@/domain/ticker';
import {applyPrefill, DRAFT_KEY, EMPTY_DRAFT, parseDraft, serializeDraft, type Prefill, type Template} from '@/lib/draft';
import {replaceQuery} from '@/lib/routes';
import {categories, formatPrice, usd, type Asset, type Draft} from '@/domain/model';
import {AssetIcon} from './asset-icon';
import {AssetFilters, INITIAL_FILTERS, sortMetricLabel, type AssetFilterState} from './asset-filters';
import {IndexRulePicker} from './index-rule-picker';
import {ruleLabel, selectIndex} from '@/lib/index-rule';
import {useCmcState} from '@/lib/cmc';
import {queryAssets} from '@/lib/asset-query';
import {useAssetData} from '@/lib/use-asset-data';
import {cmcPct, cmcUsd, pctTone} from '@/lib/cmc-format';
import {AllocationEditor, segmentColor} from './allocation-editor';
import {apiStatusText} from './api-status';
import {quoteCreate, exactAmount, units, walletFunds, fundFixtureWallet, MIN_GAS, FAUCET_USDT, vaultChain} from '@/lib/vaults';
import {useCanLaunch, useDeployment, useFlapDeployment, useVault, useVaultTransaction, type Basket} from '@/lib/use-vaults';
import {taxSummary} from '@/lib/flap';
import {savePortfolioSettings} from '@/lib/portfolio-settings';
import {LAUNCH, launchTotalUSDT} from '@/lib/launch';
import {venuePresentation} from '@/lib/venue';
import {REBALANCE_INTERVALS, REBALANCE_THRESHOLDS_BPS, bpsLabel, settingsLabel} from '@/lib/rebalance';

const steps = ['Identity', 'Composition', 'Allocation', 'Review & launch'];
const REVIEW = steps.length - 1;

/** Older drafts may not total 100%; the editor keeps the invariant from then on. */
const repair = (draft: Draft): Draft =>
  draft.allocations.length && totalOf(draft.allocations) !== 100 ? {...draft, allocations: normalize(draft.allocations)} : draft;

function readStored(): string | null {
  try {
    return sessionStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

export function Create({prefill}: {prefill: Prefill}) {
  const router = useRouter();
  // Launch venue: OpenFour (operator-signed on chain 97) or Flap (any wallet; tax token, Flap USD settlement).
  const [venue, setVenue] = useState<'openfour' | 'flap'>('openfour');
  const openfourDeployment = useDeployment();
  const flapDeployment = useFlapDeployment();
  const flapAvailable = !!flapDeployment.data;
  const settlementLabel = venuePresentation({provider: venue, fixture: false}).settlementLabel;
  const deployment = venue === 'flap' && flapDeployment.data ? {...flapDeployment, data: flapDeployment.data} : openfourDeployment;
  const transaction = useVaultTransaction(deployment.data);
  const {canLaunch} = useCanLaunch(deployment.data);
  // "Copy basket" links pass ?from=<vault address>; its composition is read from chain.
  const fromVault = useVault(deployment.data, prefill.from && isAddress(prefill.from) ? prefill.from : undefined);
  const template: Template | null = useMemo(() => fromVault.data ? {
    name: fromVault.data.name,
    allocations: fromVault.data.holdings.flatMap(h => { const asset = referenceAssetById(h.referenceAssetId); return asset ? [{asset, weight: Number(h.weightBps) / 100}] : []; }),
  } : null, [fromVault.data]);
  const waitingForTemplate = !!prefill.from && isAddress(prefill.from) && !template && !fromVault.isError && !deployment.isError;
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState<AssetFilterState>(INITIAL_FILTERS);
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [symbolEdited, setSymbolEdited] = useState(false);
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(() => new Set());
  const [quote, setQuote] = useState<{seed: bigint; liquidity: bigint; creatorShares: bigint; lpShares: bigint; draft: Draft; outputs: readonly bigint[]; basket: Basket}|null>(null);
  const [quoteError, setQuoteError] = useState('');
  const loaded = useRef(false);
  const account = useAccount();
  const switchChain = useSwitchChain();
  const [funding, setFunding] = useState('');
  const onChain = account.isConnected && account.chainId === vaultChain.id;
  const funds = useQuery({
    queryKey: ['launch-funds', deployment.data?.factory ?? 'none', account.address ?? 'none'],
    enabled: step === REVIEW && onChain && !!account.address && !!deployment.data && !!deployment.client,
    queryFn: () => walletFunds(deployment.client!, deployment.data!, account.address!),
    refetchInterval: 5000,
  });
  const needed = quote ? quote.seed + quote.liquidity : null;
  /** First thing blocking a launch, in the order the user can fix it; null when ready. */
  const blocker: {message: string; action?: 'switch' | 'fund'} | null =
    !account.isConnected ? {message: 'Connect a wallet to launch (top right).'}
    : !onChain ? {message: `Your wallet is on another network. Switch it to ${vaultChain.name} (chain ${vaultChain.id}) to launch.`, action: 'switch'}
    : !canLaunch ? {message: 'On BSC Testnet only the OpenFour launch signer (the IndexFi operator wallet) can launch. Connect it to launch; other wallets see a preview and can deposit into existing portfolios.'}
    : quoteError ? null
    : !quote ? {message: 'Waiting for the on-chain launch quote…'}
    : funds.data && needed !== null && (funds.data.usdt < needed || funds.data.gas < MIN_GAS)
      ? {message: `This wallet has ${units(funds.data.usdt, deployment.data!.settlementDecimals)} ${settlementLabel} and ${Number(units(funds.data.gas, 18)).toFixed(4)} ${vaultChain.nativeCurrency.symbol} for gas; launch needs ${units(needed, deployment.data!.settlementDecimals)} ${settlementLabel} plus gas.`, action: deployment.data?.fixture || deployment.data?.provider === 'flap' ? 'fund' : undefined}
    : null;
  async function getTestFunds() {
    if (!deployment.client || !deployment.data || !account.address) return;
    setFunding('Adding test funds…');
    try {
      // Flap USD has a public mint; the local fixture funds through the node.
      if (deployment.data.provider === 'flap') await transaction.submit({kind: 'mintTestSettlement', amount: BigInt(FAUCET_USDT) * 10n ** BigInt(deployment.data.settlementDecimals)}, 0);
      else await fundFixtureWallet(deployment.client, deployment.data, account.address);
      await funds.refetch(); setFunding('');
    }
    catch (err) { setFunding(err instanceof Error ? err.message.split('\n')[0] : 'Test funds failed'); }
  }

  // Restore this tab's draft, then apply a link's prefill once and drop it from the URL.
  useEffect(() => {
    if (loaded.current || waitingForTemplate) return;
    const saved = parseDraft(readStored());
    const result = applyPrefill(saved?.draft ?? EMPTY_DRAFT, prefill, template);
    setD(repair(result.draft));
    setSymbolEdited(Boolean(result.draft.symbol));
    setStep(result.notice ? 0 : (saved?.step ?? 0));
    setNotice(result.notice ?? (saved && saved.draft.allocations.length ? 'Your draft from this session was restored.' : null));
    if (prefill.assets || prefill.from) replaceQuery({assets: undefined, from: undefined});
    loaded.current = true;
    // Runs once per page load (after a copied basket is read); later prefill changes come with a new navigation.
  }, [waitingForTemplate]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, serializeDraft(d, step));
    } catch {}
  }, [d, step]);

  function startOver() {
    setD(EMPTY_DRAFT);
    setStep(0);
    setError('');
    setNotice(null);
    setLocked(new Set());
    setSymbolEdited(false);
    setAttempted(new Set());
  }
  const prices = usePriceState();
  const api = apiStatusText(prices);
  const update = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(old => ({...old, [k]: v}));
  const priceOf = (a: Asset) => prices.byAsset.get(a.id)?.price;

  const lockedIndex = (allocations: Draft['allocations']) => new Set(allocations.flatMap((x, i) => (locked.has(x.asset.id) ? [i] : [])));
  /** Add or remove an asset; an equal split stays equal, custom weights keep their proportions. */
  function toggle(a: Asset) {
    setD(old => {
      const index = old.allocations.findIndex(x => x.asset.id === a.id);
      const equal = isEqualSplit(old.allocations);
      const allocations =
        index >= 0
          ? equal ? equalWeights(old.allocations.filter(x => x.asset.id !== a.id)) : removeItem(old.allocations, index, lockedIndex(old.allocations))
          : equal ? equalWeights([...old.allocations, {asset: a, weight: 0}]) : addItem(old.allocations, {asset: a, weight: 0}, lockedIndex(old.allocations));
      return {...old, allocations};
    });
    setLocked(old => {
      if (!old.has(a.id)) return old;
      const next = new Set(old);
      next.delete(a.id);
      return next;
    });
  }
  function toggleLock(id: string) {
    setLocked(old => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function setName(name: string) {
    setD(old => ({...old, name, symbol: symbolEdited ? old.symbol : suggestTicker(name)}));
  }
  const issues = draftIssues(d);
  const fieldError = (prefix: string) => (attempted.has(step) ? issues.find(issue => issue.step === step && issue.message.startsWith(prefix))?.message : undefined);
  function next() {
    setAttempted(old => new Set(old).add(step));
    const relevant = issues.filter(issue => issue.step === step);
    if (relevant.length) {
      setError(relevant.map(issue => issue.message).join(' '));
      return;
    }
    setError('');
    setStep(s => s + 1);
  }

  const supportedIds = useMemo(() => new Set(deployment.data?.assets.map(a => a.referenceAssetId) ?? []), [deployment.data]);
  // Only assets the active deployment can execute; filters and sorting (Atlas + CMC data) never grant eligibility.
  const supported = useMemo(() => referenceAssets.filter(a => supportedIds.has(a.id)), [supportedIds]);
  const dataOf = useAssetData(supported);
  // Index rule (top N by CMC market cap): live preview; the composition changes only on Apply.
  const cmc = useCmcState();
  const cmcReady = supported.some(a => cmc.rows.get(a.id)?.quote?.marketCap);
  const indexSelection = useMemo(() => selectIndex(supported, d.index, a => cmc.rows.get(a.id)?.quote?.marketCap), [supported, d.index, cmc.rows]);
  const indexApplied = d.allocations.length === indexSelection.constituents.length
    && indexSelection.constituents.every((c, i) => d.allocations[i]?.asset.id === c.asset.id && Math.round(d.allocations[i].weight * 100) === c.weightBps);
  function applyIndex() {
    update('allocations', indexSelection.constituents.map(c => ({asset: c.asset, weight: c.weightBps / 100})));
    setLocked(new Set());
  }
  const options = useMemo(
    () => queryAssets(supported, {term: filters.search, category: filters.category, sort: filters.sort, direction: filters.direction}, dataOf),
    [supported, filters, dataOf],
  );

  useEffect(() => {
    let active = true;
    async function loadQuote() {
      setQuote(null); setQuoteError('');
      if (step !== REVIEW || !deployment.data || !deployment.client || issues.length) return;
      const seed = exactAmount(String(LAUNCH.collateralUSDT), deployment.data.settlementDecimals);
      const liquidity = exactAmount(String(LAUNCH.poolReserveUSDT), deployment.data.settlementDecimals);
      const legs = d.allocations.map(a => {
        const execution = deployment.data!.assets.find(x => x.referenceAssetId === a.asset.id);
        return execution ? {token: execution.address as Address, weightBps: Math.round(a.weight * 100)} : undefined;
      });
      if (!seed || !liquidity || legs.some(x => !x)) { setQuoteError('Every constituent needs a verified execution contract.'); return; }
      const basket: Basket = {name:d.name,symbol:d.symbol,metadataURI:`data:application/json,${encodeURIComponent(JSON.stringify({description:d.description,category:d.category}))}`,constituents:legs as Basket['constituents']};
      try {
        const result=await quoteCreate(deployment.client,deployment.data,basket,seed,liquidity);
        if(active) setQuote({seed,liquidity,basket,draft:d,...result});
      } catch(err) { if(active) setQuoteError(err instanceof Error ? err.message.split('\n')[0] : 'Contract quote failed'); }
    }
    void loadQuote();
    return ()=>{active=false;};
  }, [step,d,deployment.data,deployment.client]);

  async function launch() {
    if(!quote || quote.draft!==d || !deployment.data || !deployment.client) return;
    const result=await transaction.submit({kind:'create',basket:quote.basket,seed:quote.seed,liquidity:quote.liquidity,creatorShares:quote.creatorShares,outputs:quote.outputs,rebalance:d.rebalance,index:d.index},100);
    if(!result) return;
    if(result.event?.eventName!=='VaultCreated') {setError('Launch confirmed but creation event not found. Check Explore.');return;}
    const vault=result.event.args.vault;
    // Demo: keep the chosen rebalancing / index settings with the portfolio so its page can preview them.
    savePortfolioSettings(vault, {rebalance: d.rebalance, index: d.index});
    sessionStorage.removeItem(DRAFT_KEY);
    router.push(`/portfolio/${vault}`);
  }

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Creator / Launch</div>
        <h1>Create a portfolio.</h1>
        <p>Choose supported assets and weights. Every portfolio launches with {LAUNCH.collateralUSDT.toLocaleString('en-US')} {settlementLabel} of collateral at ${LAUNCH.startNav.toFixed(2)} NAV; trading through IndexFi unlocks at ${LAUNCH.tradingUnlockUSD.toLocaleString('en-US')} AUM.</p>
        {deployment.isError && <div className="notice notice--bad">Contract deployment is unavailable on this network.</div>}
      </div>
      <div className="wizard-grid">
        <aside className="wizard-aside">
          <ol className="step-list">
            {steps.map((s, i) => (
              <li key={s} className={step === i ? 'step--active' : i < step ? 'step--complete' : ''}>
                <span>{i < step ? <Check size={15} /> : String(i + 1).padStart(2, '0')}</span>
                <button type="button" disabled={i > step} onClick={() => { setStep(i); setError(''); }} aria-current={i === step ? 'step' : undefined}>{s}</button>
              </li>
            ))}
          </ol>
          <Card>
            <div className="eyebrow">Launch rules</div>
            <h3>Public basket vault.</h3>
            <p className="muted">Fixed {LAUNCH.collateralUSDT.toLocaleString('en-US')} {settlementLabel} collateral at ${LAUNCH.startNav.toFixed(2)} NAV. Anyone can deposit or redeem at NAV; PancakeSwap trading through IndexFi unlocks at ${LAUNCH.tradingUnlockUSD.toLocaleString('en-US')} AUM. Deposits and redemptions charge a fixed 0.1% creator fee.</p>
          </Card>
          <button type="button" className="text-button start-over" onClick={startOver}><RotateCcw size={13} /> Start over</button>
        </aside>
        <Card className="wizard-card">
          <div className="card-heading"><h2>{steps[step]}</h2><Badge>{step + 1} / {steps.length}</Badge></div>
          {notice && <div className="notice notice--good" role="status">{notice}</div>}
          <form noValidate onSubmit={e => { e.preventDefault(); if (step < REVIEW) next(); }}>
            <div className="form-stack">
              {step === 0 && (
                <>
                  <label className="field">
                    Portfolio name
                    <input required maxLength={64} placeholder="e.g. Crypto Leaders" value={d.name} aria-invalid={Boolean(fieldError('Enter'))} onChange={e => setName(e.target.value)} />
                    {fieldError('Enter') && <span className="field__error">{fieldError('Enter')}</span>}
                  </label>
                  <label className="field">
                    Token symbol
                    <input
                      required
                      maxLength={10}
                      placeholder="BLUE"
                      value={d.symbol}
                      aria-invalid={Boolean(fieldError('Use'))}
                      onChange={e => {
                        setSymbolEdited(e.target.value !== '');
                        update('symbol', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                      }}
                    />
                    {fieldError('Use') ? (
                      <span className="field__error">{fieldError('Use')}</span>
                    ) : (
                      <span className="field__hint">{symbolEdited ? '2–10 letters or digits.' : 'Suggested from the name; type to change it.'}</span>
                    )}
                  </label>
                  <label className="field">Category<select value={d.category} onChange={e => update('category', e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
                  <label className="field">Description<textarea maxLength={300} rows={3} value={d.description} onChange={e => update('description', e.target.value)} placeholder="Describe your investment idea" /></label>
                </>
              )}
              {step === 1 && (
                <>
                  <div className="notice notice--neutral">
                    {deployment.data?.assets.length ?? 0} execution assets are enabled by the active contract manifest. Their Atlas references provide display prices.
                  </div>
                  {prices.status !== 'ok' && <div className="notice notice--warn" role="status">{api.label}. {api.detail ?? 'Prices appear once the API responds.'}</div>}
                  {d.allocations.length > 0 && (
                    <div className="chip-list" aria-label="Selected assets">
                      {d.allocations.map(a => (
                        <button type="button" key={a.asset.id} className="chip" onClick={() => toggle(a.asset)} aria-label={`Remove ${a.asset.symbol}`}>
                          <AssetIcon asset={a.asset} /> {a.asset.symbol} <X size={13} />
                        </button>
                      ))}
                    </div>
                  )}
                  <IndexRulePicker rule={d.index} onChange={rule => update('index', rule)} selection={indexSelection} applied={indexApplied} onApply={applyIndex} quotesReady={cmcReady} />
                  {d.index.kind === 'manual' && <AssetFilters value={filters} onChange={setFilters} shown={options.length} total={supported.length} />}
                  {d.index.kind !== 'manual' ? null : !options.length ? (
                    <Empty>No matching assets.</Empty>
                  ) : (
                    <div className="asset-picker">
                      {options.map(a => (
                        <button type="button" key={a.id} className="asset-option" aria-pressed={d.allocations.some(x => x.asset.id === a.id)} onClick={() => toggle(a)}>
                          <AssetIcon asset={a} />
                          <span><strong>{a.symbol}</strong><small>{a.name} · {a.category}</small></span>
                          {(() => {
                            const data = dataOf(a), q = data.quote, metric = sortMetricLabel(filters.sort, data);
                            return (
                              <span className="asset-option__data" title={q?.marketCap ? `CMC market cap ${q.marketCap} USD · 24h ${q.change24h ?? '—'}%` : undefined}>
                                <span title={priceOf(a) ? `${priceOf(a)} USD (Atlas)` : undefined}>{formatPrice(priceOf(a))}</span>
                                {metric
                                  ? <small className={metric.tone}>{metric.text}</small>
                                  : <small>MC {cmcUsd(q?.marketCap)} · <span className={pctTone(q?.change24h)}>{cmcPct(q?.change24h)}</span></small>}
                              </span>
                            );
                          })()}
                          {d.allocations.some(x => x.asset.id === a.id) && <Check size={17} />}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="muted">{d.allocations.length} selected{d.allocations.length < 2 ? ' · select at least two' : ''} · {d.index.kind === 'topCap' ? 'weights come from the index rule; you can still adjust them next.' : 'weights are spread equally; adjust them next.'}</p>
                </>
              )}
              {step === 2 && (
                <AllocationEditor
                  allocations={d.allocations}
                  locked={locked}
                  funding={LAUNCH.collateralUSDT}
                  onChange={allocations => update('allocations', allocations)}
                  onToggleLock={toggleLock}
                  onRemove={id => {
                    const asset = d.allocations.find(a => a.asset.id === id)?.asset;
                    if (asset) toggle(asset);
                  }}
                />
              )}
              {step === REVIEW && (
                <>
                  <div className="review-section" data-testid="launch-venue">
                    <div className="card-heading"><strong>Launch venue</strong><span className="muted">{venue === 'flap' ? 'Flap direct launch' : 'OpenFour'}</span></div>
                    <div className="tabs" role="group" aria-label="Launch venue">
                      <button type="button" aria-pressed={venue === 'openfour'} onClick={() => setVenue('openfour')}>OpenFour</button>
                      <button type="button" aria-pressed={venue === 'flap'} disabled={!flapAvailable} title={flapAvailable ? undefined : 'No Flap deployment is published for this network yet'} onClick={() => setVenue('flap')}>Flap (tax token)</button>
                    </div>
                    <p className="fine-print">
                      {venue === 'flap' && deployment.data?.flap
                        ? `Any wallet can launch. The token is created by the Flap Portal at a vanity address ending in ${deployment.data.flap.saltSuffix}, settles in Flap USD, and the initial PancakeSwap LP is burned. ${taxSummary({buyTaxBps: deployment.data.flap.buyTaxBps, sellTaxBps: deployment.data.flap.sellTaxBps, taxDurationSeconds: deployment.data.flap.taxDuration})}. Vault logic is immutable.`
                        : flapAvailable ? 'Launched through OpenFour; on BSC Testnet the IndexFi operator wallet signs launches.' : 'Launched through OpenFour; no Flap deployment is published for this network yet.'}
                    </p>
                  </div>
                  <div className="review-title">
                    <h3>{d.name} · {d.symbol}</h3>
                    <span>{d.category} / Buy and hold</span>
                    <button type="button" className="text-button" onClick={() => setStep(0)}><Pencil size={13} /> Edit</button>
                  </div>
                  <div className="review-section">
                    <div className="card-heading">
                      <strong>Composition</strong>
                      <span>
                        <button type="button" className="text-button" onClick={() => setStep(1)}><Pencil size={13} /> Assets</button>{' '}
                        <button type="button" className="text-button" onClick={() => setStep(2)}><Pencil size={13} /> Weights</button>
                      </span>
                    </div>
                    <div className="allocation-bar">{d.allocations.map((a, i) => <span key={a.asset.id} style={{width: `${a.weight}%`, background: segmentColor(i)}} />)}</div>
                    <div className="table-scroll">
                      <table>
                        <thead><tr><th>Asset</th><th>Weight</th><th>{settlementLabel}</th><th>Reference price</th></tr></thead>
                        <tbody>
                          {d.allocations.map((a, i) => (
                            <tr key={a.asset.id}>
                              <td><span className="portfolio-name"><i className="alloc-row__swatch" style={{background: segmentColor(i)}} /><AssetIcon asset={a.asset} /><strong>{a.asset.symbol}</strong></span></td>
                              <td>{a.weight}%</td>
                              <td>{usd((LAUNCH.collateralUSDT * a.weight) / 100)}</td>
                              <td>{formatPrice(priceOf(a.asset))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="review-section" data-testid="rebalance-settings">
                    <div className="card-heading">
                      <strong>Rebalancing</strong>
                      <span className="muted">{settingsLabel(d.rebalance)}</span>
                    </div>
                    <p className="fine-print">
                      Prices move the actual weights away from the targets above. When the largest gap reaches the threshold and the interval has passed since
                      the last rebalance, the vault sells overweight assets and buys underweight ones back to target, at signed Atlas prices, in one
                      transaction. Settings are fixed at launch.
                    </p>
                    <div className="rebalance-pickers">
                      <div>
                        <span className="fine-print">Interval (minimum time between rebalances)</span>
                        <div className="tabs" role="group" aria-label="Rebalance interval">
                          {REBALANCE_INTERVALS.map(i => (
                            <button type="button" key={i.seconds} aria-pressed={d.rebalance.intervalSeconds === i.seconds} onClick={() => update('rebalance', {...d.rebalance, intervalSeconds: i.seconds})}>{i.label}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="fine-print">Drift threshold (largest weight gap)</span>
                        <div className="tabs" role="group" aria-label="Drift threshold">
                          {REBALANCE_THRESHOLDS_BPS.map(bps => (
                            <button type="button" key={bps} disabled={d.rebalance.intervalSeconds === 0} aria-pressed={d.rebalance.thresholdBps === bps} onClick={() => update('rebalance', {...d.rebalance, thresholdBps: bps})}>{bpsLabel(bps)}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {d.index.kind === 'topCap' && (
                      <p className="fine-print" data-testid="index-rebalance-note">
                        {d.rebalance.intervalSeconds === 0
                          ? 'Index rule with rebalancing Off: the top-cap selection applies once, at launch, and is not updated.'
                          : `Index rule: at each rebalance the vault is re-selected to the current ${ruleLabel(d.index).replace(/^Top /, 'top ')} (assets entering or leaving the top ${d.index.size} are bought or sold), then re-weighted.`}
                      </p>
                    )}
                    {d.rebalance.intervalSeconds !== 0 && d.rebalance.thresholdBps <= 10 && (
                      <p className="fine-print">0.1% is reached almost every interval with many constituents, so expect a rebalance (and its swap fees) nearly every time.</p>
                    )}
                    {deployment.data && !deployment.data.features.rebalancing && (
                      <div className="notice notice--neutral" role="status" data-testid="rebalance-demo-note">Demo: these settings are recorded with the portfolio in this app and previewed on its page (drift, the trades a rebalance would make, index changes). The contracts do not enforce them yet; on-chain rebalancing is the next contract release.</div>
                    )}
                  </div>
                  <dl className="key-values">
                    <div><dt>Constituents</dt><dd>{d.allocations.length}</dd></div>
                    <div><dt>Launch venue</dt><dd>{venue === 'flap' ? 'Flap direct launch (tax token)' : 'OpenFour'}</dd></div>
                    {venue === 'flap' && deployment.data?.flap && <>
                      <div><dt>Settlement</dt><dd>Flap USD</dd></div>
                      <div><dt>Trading tax</dt><dd>{taxSummary({buyTaxBps: deployment.data.flap.buyTaxBps, sellTaxBps: deployment.data.flap.sellTaxBps, taxDurationSeconds: deployment.data.flap.taxDuration})}</dd></div>
                      <div><dt>Initial LP</dt><dd>Burned (no creator LP)</dd></div>
                    </>}
                    <div><dt>Composition rule</dt><dd>{ruleLabel(d.index)}</dd></div>
                    <div><dt>Rebalancing</dt><dd>{settingsLabel(d.rebalance)}</dd></div>
                    <div><dt>Initial investment (collateral)</dt><dd>{LAUNCH.collateralUSDT.toLocaleString('en-US')} {settlementLabel}</dd></div>
                    <div><dt>Starting NAV</dt><dd>{usd(LAUNCH.startNav, 2)}</dd></div>
                    <div><dt>Trading unlock</dt><dd>${LAUNCH.tradingUnlockUSD.toLocaleString('en-US')} AUM, once the PancakeSwap market is operational</dd></div>
                    <div><dt>Before the unlock</dt><dd>Deposit and redeem at NAV (IndexFi primary market)</dd></div>
                    <div><dt>After the unlock</dt><dd>Buy and sell on PancakeSwap through IndexFi</dd></div>{venuePresentation({provider: venue, fixture: false}).externalTradingNotice && <div><dt>External trading</dt><dd>{venuePresentation({provider: venue, fixture: false}).externalTradingNotice}</dd></div>}
                    <div><dt>Pool reserve (fixed)</dt><dd>{LAUNCH.poolReserveUSDT.toLocaleString('en-US')} {settlementLabel}, paired with {LAUNCH.poolReserveUSDT.toLocaleString('en-US')} tokens for the PancakeSwap pool</dd></div>
                    <div><dt>Total required funding</dt><dd>{launchTotalUSDT.toLocaleString('en-US')} {settlementLabel}, excluding gas</dd></div>
                    <div><dt>Estimated creator tokens</dt><dd>{quote?units(quote.creatorShares,18):'—'}</dd></div>
                    <div><dt>Tokens allocated to AMM</dt><dd>{quote?units(quote.lpShares,18):'—'}</dd></div>
                    <div><dt>Creator fee</dt><dd>0.1% on each primary deposit and redemption</dd></div>
                    <div><dt>Execution quote</dt><dd>{quote ? `${quote.outputs.length} legs ready` : 'Loading contract quote'}</dd></div>
                    <div><dt>Public access</dt><dd>Immediate after confirmed launch</dd></div>
                  </dl>
                  {deployment.data&&canLaunch&&venuePresentation(deployment.data).launchAuthorizationNotice&&<div className="notice notice--neutral" data-testid="launch-authorization-notice">{venuePresentation(deployment.data).launchAuthorizationNotice}</div>}
                  {blocker && <div role="status" data-testid="launch-blocker" className="notice notice--neutral">{blocker.message}{' '}
                    {blocker.action === 'switch' && <button type="button" className="text-button" disabled={switchChain.isPending} onClick={() => switchChain.switchChain({chainId: vaultChain.id})}>Switch network</button>}
                    {blocker.action === 'fund' && <button type="button" className="text-button" data-testid="get-test-funds" disabled={!!funding && funding.endsWith('…')} onClick={() => void getTestFunds()}>Get test funds ({FAUCET_USDT.toLocaleString('en-US')} {settlementLabel} + gas)</button>}
                  </div>}
                  {switchChain.error && <div role="alert" className="notice notice--bad">Network switch failed: {switchChain.error.message.split('\n')[0]}. Add or select {vaultChain.name} (chain {vaultChain.id}) in your wallet.</div>}
                  {funding && <div role="status" className="notice notice--neutral">{funding}</div>}
                  {(quoteError||transaction.error) && <div role="alert" className="notice notice--bad">{quoteError||transaction.error}</div>}
                  {transaction.pending && <div role="status" className="notice notice--neutral">{transaction.pending}</div>}
                </>
              )}
            </div>
            {error && <div role="alert" className="notice notice--bad">{error}</div>}
            <div className="wizard-actions">
              <Button type="button" variant="secondary" disabled={step === 0} onClick={() => { setStep(s => s - 1); setError(''); }}><ArrowLeft size={16} /> Back</Button>
              <Button type={step===REVIEW?'button':'submit'} disabled={step === REVIEW && (!quote||quote.draft!==d||!transaction.ready||!canLaunch||!!transaction.pending||!!blocker)} onClick={step===REVIEW?()=>void launch():undefined}>{step === REVIEW ? 'Launch portfolio' : 'Continue'} <ArrowRight size={16} /></Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
