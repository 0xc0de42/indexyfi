'use client';
import {useEffect, useRef, useState} from 'react';
import {Check, ArrowRight, ArrowLeft, X, RotateCcw, Pencil} from 'lucide-react';
import {Button, Card, Badge, Empty} from '@indexfi/ui';
import {referenceAssets, testnetCollateral} from '@/lib/catalog';
import {usePriceState} from '@/lib/prices';
import {draftIssues, equalWeights, MIN_LIQUIDITY} from '@/domain/policy';
import {addItem, isEqualSplit, normalize, removeItem, totalOf} from '@/domain/allocation';
import {suggestTicker} from '@/domain/ticker';
import {applyPrefill, DRAFT_KEY, EMPTY_DRAFT, parseDraft, serializeDraft, type Prefill} from '@/lib/draft';
import {replaceQuery} from '@/lib/routes';
import {categories, formatPrice, usd, FUNDING_TOKEN, type Asset, type Draft} from '@/domain/model';
import {AssetIcon} from './asset-icon';
import {AllocationEditor, segmentColor} from './allocation-editor';
import {apiStatusText} from './api-status';

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
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [symbolEdited, setSymbolEdited] = useState(false);
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(() => new Set());
  const loaded = useRef(false);

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
  const options = referenceAssets.filter(a => `${a.name} ${a.symbol}`.toLowerCase().includes(term));

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">Creator / Launch</div>
        <h1>Create a portfolio.</h1>
        <p>Choose existing assets, allocate your {FUNDING_TOKEN} and create a fixed-supply, buy-and-hold basket.</p>
        <div className="notice notice--neutral">
          Preview: you can design and review a portfolio with live reference prices. Launching needs the contract integration (Phase III), so nothing is
          deployed or charged. Your draft is kept while this tab is open.
        </div>
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
            <h3>One basket. Fixed supply.</h3>
            <p className="muted">Pre-funded with {FUNDING_TOKEN}. No additional minting, arbitrary creator withdrawals or rebalancing. Investors exit by selling.</p>
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
                    {referenceAssets.length} verified reference assets (BNB Chain 56) with live USD reference prices from the IndexFi API. They are price references,
                    not verified testnet collateral ({testnetCollateral.length} chain-97 collateral assets verified so far).
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
                    Initial funding ({FUNDING_TOKEN})
                    <input type="number" step="0.01" min="0.01" required value={d.funding} aria-invalid={Boolean(fieldError('Funding'))} onChange={e => update('funding', Number(e.target.value))} />
                    {fieldError('Funding') && <span className="field__error">{fieldError('Funding')}</span>}
                  </label>
                  <div className="preset-row" role="group" aria-label="Funding presets">
                    {FUNDING_PRESETS.map(amount => (
                      <button type="button" key={amount} className="preset-chip" aria-pressed={d.funding === amount} onClick={() => update('funding', amount)}>
                        {amount.toLocaleString('en-US')} {FUNDING_TOKEN}
                      </button>
                    ))}
                  </div>
                  <dl className="key-values">
                    <div><dt>Separate initial market liquidity</dt><dd>{MIN_LIQUIDITY} {FUNDING_TOKEN}</dd></div>
                    <div><dt>Subtotal before execution and protocol fees</dt><dd>{usd(d.funding + MIN_LIQUIDITY)} {FUNDING_TOKEN}</dd></div>
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
                    <div><dt>Initial trading liquidity</dt><dd>{MIN_LIQUIDITY} {FUNDING_TOKEN}</dd></div>
                    <div><dt>Creator fee</dt><dd>Contract configuration pending</dd></div>
                    <div><dt>Initial shares</dt><dd>Contract quote required</dd></div>
                    <div><dt>Graduation</dt><dd>OpenFour → PancakeSwap</dd></div>
                  </dl>
                  <div className="notice notice--warn">Launch is unavailable until the atomic deployment adapter, verified testnet collateral and contract quotes are integrated (Phase III). Nothing is created or stored.</div>
                </>
              )}
            </div>
            {error && <div role="alert" className="notice notice--bad">{error}</div>}
            <div className="wizard-actions">
              <Button type="button" variant="secondary" disabled={step === 0} onClick={() => { setStep(s => s - 1); setError(''); }}><ArrowLeft size={16} /> Back</Button>
              <Button type="submit" disabled={step === 4}>{step === 4 ? 'Launch unavailable' : 'Continue'} <ArrowRight size={16} /></Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
