import {compact, percent} from '@/domain/model';
import type {CmcMapping} from './cmc-api';

/** Display-only conversions of exact CMC decimal strings. */
export const cmcUsd = (value: string | null | undefined) => compact(value == null ? null : Number(value));
/** CMC reports percent units ("1.5" = +1.5%). */
export const cmcPct = (value: string | null | undefined) => percent(value == null ? null : Number(value));
export const pctTone = (value: string | null | undefined) => (value == null ? '' : value.startsWith('-') ? 'negative' : 'positive');

export function relationLabel(mapping: CmcMapping | null | undefined): {short: string; long: string} {
  switch (mapping?.relation) {
    case 'exact_token':
      return {short: 'Same token', long: 'CMC lists this exact BNB Chain token.'};
    case 'underlying_reference':
      return {short: 'Underlying reference', long: 'CMC figures describe the underlying reference asset, not this BNB Chain wrapper (its own liquidity can differ).'};
    case 'rwa_aggregate':
      return {short: 'RWA aggregate', long: 'CMC figures aggregate a real-world-asset listing; not the underlying company capitalization.'};
    default:
      return {short: 'Not mapped', long: 'No approved CMC identity for this asset.'};
  }
}
