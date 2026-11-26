'use client';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Address} from 'viem';
import {useAccount, useSwitchChain} from 'wagmi';
import {useQuery} from '@tanstack/react-query';
import {Check, ArrowRight, ArrowLeft, X, RotateCcw, Pencil} from 'lucide-react';
import {Button, Card, Badge, Empty} from '@indexfi/ui';
import {referenceAssets} from '@/lib/catalog';
import {usePriceState} from '@/lib/prices';
import {draftIssues, equalWeights} from '@/domain/policy';
import {addItem, isEqualSplit, normalize, removeItem, totalOf} from '@/domain/allocation';
import {suggestTicker} from '@/domain/ticker';
import {applyPrefill, DRAFT_KEY, EMPTY_DRAFT, parseDraft, serializeDraft, type Prefill} from '@/lib/draft';
import {replaceQuery} from '@/lib/routes';
import {categories, formatPrice, usd, FUNDING_TOKEN, type Asset, type Draft} from '@/domain/model';
import {AssetIcon} from './asset-icon';
import {AllocationEditor, segmentColor} from './allocation-editor';
import {apiStatusText} from './api-status';
import {quoteCreate, exactAmount, units, walletFunds, fundFixtureWallet, MIN_GAS, FAUCET_USDT, vaultChain} from '@/lib/vaults';
import {useDeployment, useVaultTransaction, type Basket} from '@/lib/use-vaults';

const steps = ['Identity', 'Composition', 'Allocation', 'Funding', 'Review & launch'];
const FUNDING_PRESETS = [100, 500, 1_000, 5_000];

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
  const deployment = useDeployment();
  const transaction = useVaultTransaction(deployment.data);
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
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
    enabled: step === 4 && onChain && !!account.address && !!deployment.data && !!deployment.client,
    queryFn: () => walletFunds(deployment.client!, deployment.data!, account.address!),
    refetchInterval: 5000,
  });
  const needed = quote ? quote.seed + quote.liquidity : null;
  /** First thing blocking a launch, in the order the user can fix it; null when ready. */
  const blocker: {message: string; action?: 'switch' | 'fund'} | null =
    !account.isConnected ? {message: 'Connect a wallet to launch (top right).'}
    : !onChain ? {message: `Your wallet is on another network. Switch it to ${vaultChain.name} (chain ${vaultChain.id}) to launch.`, action: 'switch'}
    : quoteError ? null
    : !quote ? {message: 'Waiting for the on-chain launch quote…'}
    : funds.data && needed !== null && (funds.data.usdt < needed || funds.data.gas < MIN_GAS)
      ? {message: `This wallet has ${units(funds.data.usdt, deployment.data!.settlementDecimals)} USDT and ${Number(units(funds.data.gas, 18)).toFixed(4)} ${vaultChain.nativeCurrency.symbol} for gas; launch needs ${units(needed, deployment.data!.settlementDecimals)} USDT plus gas.`, action: deployment.data?.fixture ? 'fund' : undefined}
    : null;
  async function getTestFunds() {
    if (!deployment.client || !deployment.data || !account.address) return;
    setFunding('Adding test funds…');
    try { await fundFixtureWallet(deployment.client, deployment.data, account.address); await funds.refetch(); setFunding(''); }
    catch (err) { setFunding(err instanceof Error ? err.message.split('\n')[0] : 'Test funds failed'); }
  }

  // Restore this tab's draft, then apply a link's prefill once and drop it from the URL.
  useEffect(() => {
    const saved = parseDraft(readStored());
    const result = applyPrefill(saved?.draft ?? EMPTY_DRAFT, prefill);
    setD(repair(result.draft));
    setSymbolEdited(Boolean(result.draft.symbol));
    setStep(result.notice ? 0 : (saved?.step ?? 0));
    setNotice(result.notice ?? (saved && saved.draft.allocations.length ? 'Your draft from this session was restored.' : null));
    if (prefill.assets || prefill.from) replaceQuery({assets: undefined, from: undefined});
    loaded.current = true;
    // Runs once per page load; later prefill changes come with a new navigation.
  }, []);
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

  const term = search.toLowerCase();
  const supportedIds = useMemo(() => new Set(deployment.data?.assets.map(a => a.referenceAssetId) ?? []), [deployment.data]);
  const options = referenceAssets.filter(a => supportedIds.has(a.id) && `${a.name} ${a.symbol}`.toLowerCase().includes(term));

  useEffect(() => {
    let active = true;
    async function loadQuote() {
      setQuote(null); setQuoteError('');
      if (step !== 4 || !deployment.data || !deployment.client || issues.length) return;
      const seed = exactAmount(String(d.funding), deployment.data.settlementDecimals);
      const liquidity = exactAmount(String(d.liquidity), deployment.data.settlementDecimals);
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
    const result=await transaction.submit({kind:'create',basket:quote.basket,seed:quote.seed,liquidity:quote.liquidity,creatorShares:quote.creatorShares,outputs:quote.outputs},100);
    if(!result) return;
    if(result.event?.eventName!=='VaultCreated') {setError('Launch confirmed but creation event not found. Check Explore.');return;}
    const vault=result.event.args.vault;
    sessionStorage.removeItem(DRAFT_KEY);
    router.push(`/portfolio/${vault}`);
  }

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Creator / Launch</div>
        <h1>Create a portfolio.</h1>
        <p>Choose supported assets, seed the basket with at least 100 {FUNDING_TOKEN}, and provide separate liquidity and open primary and secondary markets.</p>
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
            <p className="muted">Creator funds collateral and a separate trading pool. Public deposits release backed tokens and redemptions return them to inventory. Both charge a fixed 0.1% creator fee.</p>
          </Card>
          <button type="button" className="text-button start-over" onClick={startOver}><RotateCcw size={13} /> Start over</button>
        </aside>
        <Card className="wizard-card">
          <div className="card-heading"><h2>{steps[step]}</h2><Badge>{step + 1} / 5</Badge></div>
          {notice && <div className="notice notice--good" role="status">{notice}</div>}
          <form noValidate onSubmit={e => { e.preventDefault(); if (step < 4) next(); }}>
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
                  <label className="field">Search assets<input placeholder="Name or symbol" value={search} onChange={e => setSearch(e.target.value)} /></label>
                  {!options.length ? (
                    <Empty>No matching assets.</Empty>
                  ) : (
                    <div className="asset-picker">
                      {options.map(a => (
                        <button type="button" key={a.id} className="asset-option" aria-pressed={d.allocations.some(x => x.asset.id === a.id)} onClick={() => toggle(a)}>
                          <AssetIcon asset={a} />
                          <span><strong>{a.symbol}</strong><small>{a.name} · {a.category}</small></span>
                          <span title={priceOf(a) ? `${priceOf(a)} USD` : undefined}>{formatPrice(priceOf(a))}<small>Chain 56 reference</small></span>
                          {d.allocations.some(x => x.asset.id === a.id) && <Check size={17} />}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="muted">{d.allocations.length} selected{d.allocations.length < 2 ? ' · select at least two' : ''} · weights are spread equally; adjust them next.</p>
                </>
              )}
              {step === 2 && (
                <AllocationEditor
                  allocations={d.allocations}
                  locked={locked}
                  funding={d.funding}
                  onChange={allocations => update('allocations', allocations)}
                  onToggleLock={toggleLock}
                  onRemove={id => {
                    const asset = d.allocations.find(a => a.asset.id === id)?.asset;
                    if (asset) toggle(asset);
                  }}
                />
              )}
              {step === 3 && (
                <>
                  <label className="field">
                    Initial collateral funding ({FUNDING_TOKEN})
                    <input type="number" step="0.01" min="0.01" required value={d.funding} aria-invalid={Boolean(fieldError('Funding'))} onChange={e => update('funding', Number(e.target.value))} />
                    {fieldError('Funding') && <span className="field__error">{fieldError('Funding')}</span>}
                  </label>
                  <label className="field">Separate AMM liquidity (USDT)<input type="number" step="0.01" min="1" required value={d.liquidity} onChange={e=>update('liquidity',Number(e.target.value))}/></label>
                  <div className="preset-row" role="group" aria-label="Funding presets">
                    {FUNDING_PRESETS.map(amount => (
                      <button type="button" key={amount} className="preset-chip" aria-pressed={d.funding === amount} onClick={() => update('funding', amount)}>
                        {amount.toLocaleString('en-US')} {FUNDING_TOKEN}
                      </button>
                    ))}
                  </div>
                  <dl className="key-values">
                    <div><dt>Minimum opening seed</dt><dd>100 {FUNDING_TOKEN}</dd></div>
                    <div><dt>Primary fees</dt><dd>0.1% deposit and redemption; initial seed fee-free</dd></div>
                  </dl>
                  <div className="table-scroll">
                    <table>
                      <thead><tr><th>Asset</th><th>Allocation</th><th>Reference price</th><th>Indicative quantity</th></tr></thead>
                      <tbody>
                        {d.allocations.map(a => {
                          const price = priceOf(a.asset);
                          const value = price ? Number(price) : null;
                          return (
                            <tr key={a.asset.id}>
                              <td>{a.asset.symbol}</td>
                              <td>{usd((d.funding * a.weight) / 100)}</td>
                              <td>{formatPrice(price)}</td>
                              <td>{value ? ((d.funding * a.weight) / 100 / value).toPrecision(5) : 'Price unavailable'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="fine-print">Indicative only: latest USD reference prices assuming USD/USDT parity, not executable swap quotes. On-chain acquisition and activation must be atomic.</p>
                </>
              )}
              {step === 4 && (
                <>
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
                        <thead><tr><th>Asset</th><th>Weight</th><th>{FUNDING_TOKEN}</th><th>Reference price</th></tr></thead>
                        <tbody>
                          {d.allocations.map((a, i) => (
                            <tr key={a.asset.id}>
                              <td><span className="portfolio-name"><i className="alloc-row__swatch" style={{background: segmentColor(i)}} /><AssetIcon asset={a.asset} /><strong>{a.asset.symbol}</strong></span></td>
                              <td>{a.weight}%</td>
                              <td>{usd((d.funding * a.weight) / 100)}</td>
                              <td>{formatPrice(priceOf(a.asset))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <dl className="key-values">
                    <div><dt>Constituents</dt><dd>{d.allocations.length}</dd></div>
                    <div><dt>{FUNDING_TOKEN} investment <button type="button" className="text-button" onClick={() => setStep(3)}><Pencil size={12} /> Edit</button></dt><dd>{usd(d.funding)}</dd></div>
                    <div><dt>AMM USDT reserve</dt><dd>{usd(d.liquidity)}</dd></div>
                    <div><dt>Total funding</dt><dd>{usd(d.funding+d.liquidity)}</dd></div>
                    <div><dt>Estimated creator tokens</dt><dd>{quote?units(quote.creatorShares,18):'—'}</dd></div>
                    <div><dt>Tokens allocated to AMM</dt><dd>{quote?units(quote.lpShares,18):'—'}</dd></div>
                    <div><dt>Creator fee</dt><dd>0.1% on each primary deposit and redemption</dd></div>
                    <div><dt>Execution quote</dt><dd>{quote ? `${quote.outputs.length} legs ready` : 'Loading contract quote'}</dd></div>
                    <div><dt>Public access</dt><dd>Immediate after confirmed launch</dd></div>
                  </dl>
                  {deployment.data&&!deployment.data.fixture&&<div className="notice notice--neutral">Public launch disabled until an authorized OpenFour signer is configured.</div>}
                  {blocker && <div role="status" data-testid="launch-blocker" className="notice notice--neutral">{blocker.message}{' '}
                    {blocker.action === 'switch' && <button type="button" className="text-button" disabled={switchChain.isPending} onClick={() => switchChain.switchChain({chainId: vaultChain.id})}>Switch network</button>}
                    {blocker.action === 'fund' && <button type="button" className="text-button" data-testid="get-test-funds" disabled={!!funding && funding.endsWith('…')} onClick={() => void getTestFunds()}>Get test funds ({FAUCET_USDT.toLocaleString('en-US')} USDT + gas)</button>}
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
              <Button type={step===4?'button':'submit'} disabled={step === 4 && (!quote||quote.draft!==d||!transaction.ready||!deployment.data?.fixture||!!transaction.pending||!!blocker)} onClick={step===4?()=>void launch():undefined}>{step === 4 ? 'Launch vault' : 'Continue'} <ArrowRight size={16} /></Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
