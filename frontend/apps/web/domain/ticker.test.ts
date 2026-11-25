import {describe, expect, it} from 'vitest';
import {suggestTicker} from './ticker';

describe('suggestTicker', () => {
  it('uses initials for multi-word names and a prefix for one word', () => {
    expect(suggestTicker('Crypto Leaders')).toBe('CL');
    expect(suggestTicker('BNB DeFi Blue Chips')).toBe('BDBC');
    expect(suggestTicker('stablecoins')).toBe('STAB');
  });
  it('drops punctuation and accents and always yields a valid ticker or nothing', () => {
    expect(suggestTicker('Café — Réserve')).toBe('CR');
    expect(suggestTicker('X')).toBe('XX');
    expect(suggestTicker('  ')).toBe('');
    for (const name of ['Crypto Leaders', 'a b c d e f g', 'Layer 2 Index', 'Z']) expect(suggestTicker(name)).toMatch(/^[A-Z0-9]{2,10}$/);
  });
});
