'use client';
import {useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';
import {Lock, LockOpen, Minus, Plus, X} from 'lucide-react';
import {equalize, isEqualSplit, maxWeight, minWeight, moveBoundary, setWeight, totalOf} from '@/domain/allocation';
import {FUNDING_TOKEN, usd, type Asset} from '@/domain/model';
import {AssetIcon} from './asset-icon';

type Allocation = {asset: Asset; weight: number};

/** Distinct colours by position, so neighbouring segments never look alike. */
const SEGMENT_COLORS = ['#eb5013', '#2f6fb3', '#2e8b6e', '#b8862f', '#8a5cc2', '#c2456e', '#3f9fb8', '#6f7d2c'];
export const segmentColor = (index: number) => SEGMENT_COLORS[index % SEGMENT_COLORS.length];

const pct = (weight: number) => `${weight.toFixed(weight % 1 === 0 ? 0 : 2)}%`;

/**
 * One bar, one draggable handle between each pair of neighbours: dragging moves weight
 * between those two only. Handles are sliders for keyboard users (← → 1%, Shift 0.1%).
 */
function SplitBar({allocations, locked, onChange}: {allocations: Allocation[]; locked: ReadonlySet<number>; onChange: (next: Allocation[]) => void}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const starts: number[] = [];
  allocations.reduce((sum, a) => (starts.push(sum), sum + a.weight), 0);

  function moveTo(boundary: number, clientX: number, fine: boolean) {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const at = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
    const step = fine ? 0.1 : 0.5;
    onChange(moveBoundary(allocations, boundary, Math.round((at - starts[boundary]) / step) * step, locked));
  }
  function onKey(event: KeyboardEvent, boundary: number) {
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    onChange(moveBoundary(allocations, boundary, allocations[boundary].weight + delta * (event.shiftKey ? 0.1 : 1), locked));
  }

  return (
    <div className="split-bar" ref={bar}>
      {allocations.map((a, i) => (
        <span key={a.asset.id} className={`split-bar__segment${locked.has(i) ? ' split-bar__segment--locked' : ''}`} style={{width: `${a.weight}%`, background: segmentColor(i)}} title={`${a.asset.symbol} ${pct(a.weight)}`}>
          {a.weight >= 9 && <><strong>{a.asset.symbol}</strong> {pct(a.weight)}</>}
        </span>
      ))}
      {allocations.slice(0, -1).map((a, i) => {
        const disabled = locked.has(i) || locked.has(i + 1);
        return (
          <span
            key={`${a.asset.id}-handle`}
            className="split-bar__handle"
            style={{left: `${starts[i + 1]}%`}}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            aria-label={`Split between ${a.asset.symbol} and ${allocations[i + 1].asset.symbol}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={a.weight}
            aria-valuetext={`${a.asset.symbol} ${pct(a.weight)}, ${allocations[i + 1].asset.symbol} ${pct(allocations[i + 1].weight)}`}
            onPointerDown={(event: PointerEvent<HTMLSpanElement>) => {
              if (disabled) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = i;
            }}
            onPointerMove={(event: PointerEvent<HTMLSpanElement>) => {
              if (dragging.current === i) moveTo(i, event.clientX, event.shiftKey);
            }}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
            onKeyDown={event => !disabled && onKey(event, i)}
          />
        );
      })}
    </div>
  );
}

/** Percent field that applies on Enter or blur, so typing "2" on the way to "25" does not rebalance. */
function WeightInput({value, min, max, label, disabled, onCommit}: {value: number; min: number; max: number; label: string; disabled: boolean; onCommit: (weight: number) => void}) {
  // Text being typed; null shows the live weight.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(',', '.'));
    setDraft(null);
    if (Number.isFinite(parsed) && draft.trim() !== '') onCommit(Math.round(Math.min(max, Math.max(min, parsed)) * 100) / 100);
  };
  return (
    <label className="weight-number">
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft ?? String(value)}
        disabled={disabled}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') setDraft(null);
        }}
      />
      %
    </label>
  );
}

export function AllocationEditor({
  allocations,
  locked,
  funding,
  onChange,
  onToggleLock,
  onRemove,
}: {
  allocations: Allocation[];
  /** Locked asset IDs. */
  locked: ReadonlySet<string>;
  funding: number;
  onChange: (next: Allocation[]) => void;
  onToggleLock: (assetId: string) => void;
  onRemove: (assetId: string) => void;
}) {
  const lockedIndex = new Set(allocations.flatMap((a, i) => (locked.has(a.asset.id) ? [i] : [])));
  const total = totalOf(allocations);
  const set = (i: number, weight: number) => onChange(setWeight(allocations, i, weight, lockedIndex));
  const allLockedButOne = allocations.length - lockedIndex.size <= 1;

  return (
    <div className="allocation-editor">
      <div className="allocation-editor__head">
        <span className="muted">
          Drag the dividers or edit a row; the other weights adjust so the total stays <strong className="positive">{pct(total)}</strong>.
        </span>
        <button type="button" className="button button--secondary" disabled={isEqualSplit(allocations) || allLockedButOne} onClick={() => onChange(equalize(allocations, lockedIndex))}>
          Equal weight{lockedIndex.size ? ' (unlocked)' : ''}
        </button>
      </div>
      <SplitBar allocations={allocations} locked={lockedIndex} onChange={onChange} />
      <ul className="alloc-rows">
        {allocations.map((a, i) => {
          const isLocked = lockedIndex.has(i);
          const fixed = isLocked || allLockedButOne;
          const min = minWeight(allocations, i, lockedIndex);
          const max = maxWeight(allocations, i, lockedIndex);
          return (
            <li key={a.asset.id} className={`alloc-row${isLocked ? ' alloc-row--locked' : ''}`}>
              <span className="portfolio-name">
                <i className="alloc-row__swatch" style={{background: segmentColor(i)}} />
                <AssetIcon asset={a.asset} />
                <span><strong>{a.asset.symbol}</strong><small>{a.asset.name}</small></span>
              </span>
              <span className="alloc-row__stepper">
                <button type="button" className="icon-button" aria-label={`Decrease ${a.asset.symbol} by 1%`} disabled={fixed || a.weight <= min} onClick={() => set(i, a.weight - 1)}><Minus size={14} /></button>
                <input
                  type="range"
                  aria-label={`${a.asset.symbol} weight`}
                  min={0}
                  max={100}
                  step={0.5}
                  value={a.weight}
                  disabled={fixed}
                  onChange={event => set(i, Math.min(max, Math.max(min, Number(event.target.value))))}
                />
                <button type="button" className="icon-button" aria-label={`Increase ${a.asset.symbol} by 1%`} disabled={fixed || a.weight >= max} onClick={() => set(i, a.weight + 1)}><Plus size={14} /></button>
              </span>
              <WeightInput value={a.weight} min={min} max={max} label={`${a.asset.symbol} percent`} disabled={fixed} onCommit={weight => set(i, weight)} />
              <span className="alloc-row__amount" title="Share of the initial funding">≈ {usd((funding * a.weight) / 100)} <small>{FUNDING_TOKEN}</small></span>
              <span className="alloc-row__actions">
                <button type="button" className="icon-button" aria-pressed={isLocked} aria-label={`${isLocked ? 'Unlock' : 'Lock'} ${a.asset.symbol} weight`} title={isLocked ? 'Unlock weight' : 'Lock weight'} onClick={() => onToggleLock(a.asset.id)}>
                  {isLocked ? <Lock size={14} /> : <LockOpen size={14} />}
                </button>
                <button type="button" className="icon-button" aria-label={`Remove ${a.asset.symbol}`} title="Remove" disabled={allocations.length <= 2} onClick={() => onRemove(a.asset.id)}><X size={14} /></button>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted">Locked weights stay fixed. Every asset keeps at least 0.5%. Weights drift with market prices after launch; no automated rebalancing.</p>
    </div>
  );
}
