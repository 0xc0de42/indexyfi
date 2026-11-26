import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';

const web = join(__dirname, '..');
const roots = ['app', 'components', 'lib', 'domain', 'data'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}
const files = roots.flatMap(root => sources(join(web, root)));

// The one sanctioned exception: the server-side route that fetches Atlas-signed prices for on-chain injection
// (createVaultWithPrices / depositWithPrices / redeemWithPrices). The key stays on the server; the browser only
// receives signed payloads that the oracle contract verifies. Guarded below: server-only, imported only by the route.
const SERVER_ATLAS_BOUNDARY = [join('app', 'api', 'atlas', 'signed', 'route.ts'), join('lib', 'server', 'atlas-pull.ts')];
const SERVER_ONLY_PATTERNS = new Set(['direct Atlas access', 'API keys']);

describe('transport boundaries', () => {
  it.each([
    ['direct Atlas access', /atlasoracle|push\.atlas/i],
    ['WebSocket transport', /new WebSocket|\/ws\/prices|ws:\/\//],
    ['consensus status claims', /consensusStatus/],
    // The only versioned routes are the documented CMC endpoints (backend/docs/CMC_API.md), confined to lib/cmc-api.ts below.
    ['versioned or invented backend paths', /\/backend\/(v1|health|assets|ws)\b|['"`]\/(v1(?!\/cmc\/(assets|quotes|history)['"`?])|health)\//],
    ['API keys', /ATLAS_API_KEY|api[_-]?key/i],
    ['demo mode', /NEXT_PUBLIC_DATA_MODE|demo-store|useDemo/],
  ])('has no %s in application code', (label, pattern) => {
    const offenders = files.filter(path => pattern.test(readFileSync(path, 'utf8'))).map(path => relative(web, path))
      .filter(path => !(SERVER_ONLY_PATTERNS.has(label) && SERVER_ATLAS_BOUNDARY.includes(path)));
    expect(offenders).toEqual([]);
  });

  it('requests the rebalance keeper status only from its client', () => {
    const users = files.filter(path => /\/v1\/rebalancer\//.test(readFileSync(path, 'utf8'))).map(path => relative(web, path));
    expect(users).toEqual([join('lib', 'keeper-api.ts')]);
  });

  it('requests CMC routes only from the typed CMC client', () => {
    const users = files.filter(path => /\/v1\/cmc\//.test(readFileSync(path, 'utf8'))).map(path => relative(web, path));
    expect(users).toEqual([join('lib', 'cmc-api.ts')]);
  });

  it('keeps the signed-price Atlas boundary server-only', () => {
    for (const path of SERVER_ATLAS_BOUNDARY) {
      const source = readFileSync(join(web, path), 'utf8');
      expect(source, path).not.toMatch(/['"]use client['"]/);
      expect(source, path).not.toMatch(/NEXT_PUBLIC_/);
    }
    const importers = files.filter(path => /from\s+['"][^'"]*lib\/server\//.test(readFileSync(path, 'utf8'))).map(path => relative(web, path));
    expect(importers).toEqual([join('app', 'api', 'atlas', 'signed', 'route.ts')]);
  });

  it('issues /snapshot requests only from the API client', () => {
    const offenders = files.filter(path => /['"]\/snapshot['"?]/.test(readFileSync(path, 'utf8')) && !path.endsWith(join('lib', 'api.ts')));
    expect(offenders.map(path => relative(web, path))).toEqual([]);
  });

  it('calls only GET /snapshot and GET /history', () => {
    const client = readFileSync(join(web, 'lib', 'api.ts'), 'utf8');
    const paths = new Set([...client.matchAll(/['"`](\/[a-z][a-z0-9_/-]*)/g)].map(match => match[1]).filter(path => !path.startsWith('/backend')));
    expect([...paths].sort()).toEqual(['/history', '/snapshot']);
  });

  it('constructs the poller only in the app-level provider', () => {
    const offenders = files.filter(path => /new PricePoller/.test(readFileSync(path, 'utf8')) && !path.endsWith(join('lib', 'prices.tsx')));
    expect(offenders.map(path => relative(web, path))).toEqual([]);
  });
});
