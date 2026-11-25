'use client';
import type {ReactNode} from 'react';
import {Badge, Card} from '@indexfi/ui';
import type {Asset} from '@/domain/model';
import type {WindowLabel} from '@/lib/routes';
import {useAssetHistory} from '@/lib/use-history';
import {AssetIcon} from './asset-icon';
import {PriceLineChart} from './charts';

export const HISTORY_WINDOWS = [
  ['5m', 5 * 60_000],
  ['15m', 15 * 60_000],
  ['1h', 60 * 60_000],
  ['6h', 6 * 60 * 60_000],
  ['24h', 24 * 60 * 60_000],
] as const satisfies readonly (readonly [WindowLabel, number])[];

export const windowMsOf = (label: WindowLabel | undefined) => HISTORY_WINDOWS.find(([l]) => l === label)?.[1] ?? HISTORY_WINDOWS[0][1];
export const windowLabelOf = (ms: number): WindowLabel => HISTORY_WINDOWS.find(([, m]) => m === ms)?.[0] ?? HISTORY_WINDOWS[0][0];

/**
 * Reference-price chart for one asset. History is requested once per asset/window
 * change (filtered by asset_id), then extended with live samples from the shared poller.
 */
export function AssetChart({
  asset,
  choices,
  onChoose,
  windowMs,
  onWindow,
  title = 'Reference price',
  actions,
  className,
}: {
  asset: Asset;
  choices?: readonly Asset[];
  onChoose?: (id: string) => void;
  windowMs: number;
  onWindow: (ms: number) => void;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const history = useAssetHistory([asset.id], windowMs);
  return (
    <Card className={className}>
      <div className="card-heading">
        <h2>{title}</h2>
        <Badge>Atlas feed #{asset.feedId}</Badge>
      </div>
      <div className="chart-toolbar">
        {choices && choices.length > 1 && onChoose ? (
          <div className="tabs chart-tabs" role="group" aria-label="Constituent">
            {choices.map(choice => (
              <button key={choice.id} aria-pressed={choice.id === asset.id} onClick={() => onChoose(choice.id)}>
                <AssetIcon asset={choice} /> {choice.symbol}
              </button>
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="tabs chart-tabs" role="group" aria-label="Time window">
          {HISTORY_WINDOWS.map(([label, ms]) => (
            <button key={ms} aria-pressed={ms === windowMs} onClick={() => onWindow(ms)}>{label}</button>
          ))}
        </div>
      </div>
      {history.status === 'error' && (
        <div className="notice notice--warn" role="status">
          Stored history unavailable: {history.error}{' '}
          <button className="text-button" onClick={history.retry}>Retry</button> Live samples continue below.
        </div>
      )}
      {history.status === 'loading' && !history.series(asset.id).length ? (
        <div className="empty chart-empty">Loading stored minute closes…</div>
      ) : (
        <PriceLineChart
          points={history.series(asset.id)}
          now={history.now}
          windowMs={windowMs}
          label={asset.symbol}
          windowLabel={windowLabelOf(windowMs)}
        />
      )}
      {actions && <div className="chart-actions">{actions}</div>}
      <p className="fine-print">
        Stored minute closes from the price server, then 1-second samples while this page is open. Gaps are real; nothing is interpolated. Times are
        server sample times, not oracle update times.
      </p>
    </Card>
  );
}
