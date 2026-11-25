'use client';
import {useState} from 'react';
import {Check, ArrowRight, ArrowLeft} from 'lucide-react';
import {Button, Card, Badge, Empty} from '@indexfi/ui';
import {referenceAssets, testnetCollateral} from '@/lib/catalog';
import {usePriceState} from '@/lib/prices';
import {draftErrors, equalWeights, MIN_LIQUIDITY} from '@/domain/policy';
import {categories, formatPrice, usd, FUNDING_TOKEN, type Asset, type Draft} from '@/domain/model';
import {AssetIcon} from './asset-icon';
import {apiStatusText} from './api-status';

const steps = ['Identity', 'Composition', 'Allocation', 'Funding', 'Review & launch'];
const initial: Draft = {name: '', symbol: '', description: '', category: 'Crypto', allocations: [], funding: 100};

export function Create() {
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const prices = usePriceState();
  const api = apiStatusText(prices);
  const update = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(old => ({...old, [k]: v}));
  const total = d.allocations.reduce((s, a) => s + a.weight, 0);
  const priceOf = (a: Asset) => prices.byAsset.get(a.id)?.price;

  function toggle(a: Asset) {
    setD(old => ({
      ...old,
      allocations: equalWeights(
        old.allocations.some(x => x.asset.id === a.id) ? old.allocations.filter(x => x.asset.id !== a.id) : [...old.allocations, {asset: a, weight: 0}],
      ),
    }));
  }
  function setWeight(id: string, w: number) {
    update('allocations', d.allocations.map(a => (a.asset.id === id ? {...a, weight: w} : a)));
  }
  function next() {
    const all = draftErrors(d);
    const relevant =
      step === 0
        ? all.filter(e => e.startsWith('Enter') || e.startsWith('Use'))
        : step === 1
          ? all.filter(e => e.startsWith('Select') || e.startsWith('Duplicate'))
          : step === 2
            ? all.filter(e => /weight/i.test(e))
            : step === 3
              ? all.filter(e => e.startsWith('Funding'))
              : all;
    if (relevant.length) {
      setError(relevant.join(' '));
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
        </aside>
        <Card className="wizard-card">
          <div className="card-heading"><h2>{steps[step]}</h2><Badge>{step + 1} / 5</Badge></div>
          <form onSubmit={e => { e.preventDefault(); if (step < 4) next(); }}>
            <div className="form-stack">
              {step === 0 && (
                <>
                  <label className="field">Portfolio name<input required maxLength={64} placeholder="e.g. Crypto Leaders" value={d.name} onChange={e => update('name', e.target.value)} /></label>
                  <label className="field">Token symbol<input required maxLength={10} placeholder="BLUE" value={d.symbol} onChange={e => update('symbol', e.target.value.toUpperCase())} /></label>
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
                  <p className="muted">{d.allocations.length} selected · no arbitrary asset-count limit; execution remains gas-bounded.</p>
                </>
              )}
              {step === 2 && (
                <>
                  <div className="card-heading">
                    <span className="muted">Initial weights</span>
                    <Button type="button" variant="secondary" onClick={() => update('allocations', equalWeights(d.allocations))}>Equal weight</Button>
                  </div>
                  {d.allocations.map(a => (
                    <div className="allocation-control" key={a.asset.id}>
                      <span className="portfolio-name"><AssetIcon asset={a.asset} /><strong>{a.asset.symbol}</strong></span>
                      <input aria-label={`${a.asset.symbol} slider`} type="range" min="0" max="100" step="0.01" value={a.weight} onChange={e => setWeight(a.asset.id, Number(e.target.value))} />
                      <label className="weight-number"><input aria-label={`${a.asset.symbol} percent`} type="number" min="0" max="100" step="0.01" value={a.weight} onChange={e => setWeight(a.asset.id, Number(e.target.value))} />%</label>
                    </div>
                  ))}
                  <div className="allocation-bar">{d.allocations.map(a => <span key={a.asset.id} style={{width: `${a.weight}%`, background: a.asset.color}} />)}</div>
                  <div className="card-heading"><span>Total allocation</span><strong className={Math.abs(total - 100) < 0.00001 ? 'positive' : 'negative'}>{total.toFixed(2)}%</strong></div>
                  <p className="muted">Weights drift with market prices after launch. No automated rebalancing.</p>
                </>
              )}
              {step === 3 && (
                <>
                  <label className="field">Initial funding ({FUNDING_TOKEN})<input type="number" step="0.01" min="0.01" required value={d.funding} onChange={e => update('funding', Number(e.target.value))} /></label>
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
                  <div className="review-title"><h3>{d.name} · {d.symbol}</h3><span>{d.category} / Buy and hold</span></div>
                  <dl className="key-values">
                    <div><dt>Constituents</dt><dd>{d.allocations.length}</dd></div>
                    <div><dt>{FUNDING_TOKEN} investment</dt><dd>{usd(d.funding)}</dd></div>
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
