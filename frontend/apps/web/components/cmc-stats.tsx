'use client';
import {Badge, Card, Metric} from '@indexfi/ui';
import type {Asset} from '@/domain/model';
import {describeCmcError} from '@/lib/cmc-api';
import {useCmcRow, useCmcState} from '@/lib/cmc';
import {cmcPct, cmcUsd, pctTone, relationLabel} from '@/lib/cmc-format';
import {ageText, localTimeWithZone} from '@/lib/chart-scale';

/** Read-only CMC market statistics for one reference asset. */
export function CmcStats({asset}: {asset: Asset}) {
  const state = useCmcState();
  const {row, mapping} = useCmcRow(asset.id);
  const q = row?.quote ?? null;
  const relation = relationLabel(mapping);
  const pct = (label: string, v: string | null | undefined) => <Metric label={label} value={<span className={pctTone(v)}>{cmcPct(v)}</span>} />;
  return (
    <Card data-testid="cmc-stats">
      <div className="card-heading">
        <h2>CMC market data</h2>
        <span title={relation.long}><Badge tone={mapping?.relation === 'exact_token' ? 'good' : 'neutral'}>{relation.short}</Badge></span>
      </div>
      {!q ? (
        <p className="muted">
          {state.status === 'loading' || state.status === 'idle' ? 'Loading CMC market data…'
            : !mapping ? relation.long
            : state.error ? `${describeCmcError(state.error)} No quote received yet.`
            : row?.status === 'error' ? `CMC quote unavailable (${row.error ?? 'provider error'}).` : 'No CMC quote received yet.'}
        </p>
      ) : (
        <>
          <div className="price-metrics">
            <Metric label="Market cap" value={cmcUsd(q.marketCap)} detail={q.rank ? `CMC rank #${q.rank}` : 'unranked'} />
            <Metric label="24h volume" value={cmcUsd(q.volume24h)} detail="all venues, not the PancakeSwap pool" />
            <Metric label="CMC price" value={q.price ? `$${Number(q.price).toPrecision(6)}` : '—'} detail="reference, not NAV" />
            {pct('24h', q.change24h)}
            {pct('7d', q.change7d)}
            {pct('30d', q.change30d)}
            {pct('90d', q.change90d)}
          </div>
        </>
      )}
      <p className="fine-print">
        {mapping ? <>CMC #{mapping.cmcId} · {relation.long} </> : null}
        {q ? <span title={`${new Date(q.timestampMs).toISOString()} (UTC)`}>Quote time {localTimeWithZone(q.timestampMs)}, {ageText(q.timestampMs)} (provider). </span> : null}
        Source: CoinMarketCap via the IndexFi API, refreshed every minute.
      </p>
    </Card>
  );
}
