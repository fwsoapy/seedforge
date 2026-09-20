/**
 * Saved seeds come back out of localStorage and shared seeds come back out of
 * a URL, so both are untrusted input. These cover the round trip, what junk
 * survives it, the caps, and the expiry a share link carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SAVED_SEEDS,
  SHARE_DAYS,
  daysLeft,
  decodeShare,
  encodeShare,
  loadSavedSeeds,
  newSeedKey,
  readRecord,
  saveSavedSeeds,
  type SavedSeed,
  type SeedRecord,
} from '../src/data/saved-seeds';
import { KIND } from '../src/search/types';

const KEY = 'seedforge:seeds';
const DAY = 24 * 60 * 60 * 1000;

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

const record = (over: Record<string, unknown> = {}): SeedRecord => ({
  seed: '12345',
  mc: 40,
  edition: 0,
  target: 1,
  criteria: [{ kind: KIND.structure, id: 5, radius: 200 }],
  rules: [],
  ...over,
} as SeedRecord);

const saved = (over: Record<string, unknown> = {}): SavedSeed => ({
  ...record(),
  key: 'seed-1',
  savedAt: 1_700_000_000_000,
  ...over,
} as SavedSeed);

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe('saved seeds', () => {
  it('round-trips', () => {
    const one = saved({
      criteria: [
        { kind: KIND.structure, id: 5, radius: 100, variants: { biome: 'plains' } },
        { kind: KIND.biome, id: 4, radius: 300 },
      ],
      rules: [{ a: [KIND.structure, 5], b: [KIND.biome, 4], maxDist: 250 }],
      note: 'nice one',
    });
    expect(saveSavedSeeds([one])).toBe(true);
    expect(loadSavedSeeds()).toEqual([one]);
  });

  it('survives junk instead of throwing', () => {
    for (const junk of ['', 'not json', '{}', 'null', '5', '[1,2,3]']) {
      store.set(KEY, junk);
      expect(loadSavedSeeds()).toEqual([]);
    }
  });

  it('drops malformed entries and keeps the rest', () => {
    store.set(KEY, JSON.stringify([
      saved({ key: 'a' }),
      saved({ key: 'b', seed: 'not a number' }),
      saved({ key: 'c', seed: '' }),
      saved({ key: 'd', criteria: [] }),
      saved({ key: 'e', edition: 7 }),
      saved({ key: 'f', target: 9 }),
      saved({ key: 'g', criteria: [{ kind: 0, id: 5, radius: 0 }] }),
      saved({ key: 'h' }),
    ]));
    expect(loadSavedSeeds().map((x) => x.key)).toEqual(['a', 'h']);
  });

  it('rejects a seed that does not fit in 64 bits', () => {
    store.set(KEY, JSON.stringify([saved({ seed: '99999999999999999999999' })]));
    expect(loadSavedSeeds()).toEqual([]);
  });

  it('keeps negative seeds, which Java uses constantly', () => {
    store.set(KEY, JSON.stringify([saved({ seed: '-4986462001974439971' })]));
    expect(loadSavedSeeds()[0]!.seed).toBe('-4986462001974439971');
  });

  it('never keeps more than the cap, reading or writing', () => {
    const many = Array.from({ length: 20 }, (_, i) => saved({ key: `k${i}` }));
    saveSavedSeeds(many);
    expect(JSON.parse(store.get(KEY)!).length).toBe(MAX_SAVED_SEEDS);
    store.set(KEY, JSON.stringify(many));
    expect(loadSavedSeeds().length).toBe(MAX_SAVED_SEEDS);
  });

  it('drops duplicate keys', () => {
    store.set(KEY, JSON.stringify([saved({ key: 'x', seed: '1' }), saved({ key: 'x', seed: '2' })]));
    expect(loadSavedSeeds().map((s) => s.seed)).toEqual(['1']);
  });

  it('reports failure rather than throwing when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    expect(saveSavedSeeds([saved()])).toBe(false);
    expect(loadSavedSeeds()).toEqual([]);
  });

  it('hands out distinct keys', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newSeedKey()));
    expect(keys.size).toBe(200);
  });
});

describe('share links', () => {
  const now = 1_800_000_000_000;

  it('round-trips through the payload', () => {
    const r = record({ note: 'hi', rules: [{ a: [KIND.structure, 5], b: [KIND.biome, 4], maxDist: 250 }] });
    const decoded = decodeShare(encodeShare(r, now), now);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.record).toEqual(r);
  });

  it('survives a seed that is not URL-safe on its own', () => {
    const r = record({ seed: '-9223372036854775808' });
    const payload = encodeShare(r, now);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = decodeShare(payload, now);
    expect(decoded.ok && decoded.record.seed).toBe('-9223372036854775808');
  });

  it('lasts a week and then stops', () => {
    const payload = encodeShare(record(), now);
    expect(decodeShare(payload, now + 6 * DAY).ok).toBe(true);
    const late = decodeShare(payload, now + (SHARE_DAYS * DAY) + 1000);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('expired');
  });

  it('reports the days left', () => {
    const payload = encodeShare(record(), now);
    const decoded = decodeShare(payload, now);
    expect(decoded.ok && daysLeft(decoded.expiresAt, now)).toBe(SHARE_DAYS);
    if (decoded.ok) expect(daysLeft(decoded.expiresAt, now + 6.5 * DAY)).toBe(1);
  });

  it('rejects anything it cannot read rather than guessing', () => {
    for (const bad of ['', 'not base64!!', 'YWJj', btoa('{"v":1}'), btoa('null')]) {
      const out = decodeShare(bad, now);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('unreadable');
    }
  });

  it('rejects a payload from a different version', () => {
    const payload = btoa(JSON.stringify({ ...record(), v: 99, exp: now / 1000 + 1000 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeShare(payload, now).ok).toBe(false);
  });

  it('rejects a tampered payload that drops required fields', () => {
    const payload = btoa(JSON.stringify({ v: 1, exp: now / 1000 + 1000, seed: '5' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeShare(payload, now).ok).toBe(false);
  });
});

describe('readRecord', () => {
  it('accepts the shapes the app produces and refuses the rest', () => {
    expect(readRecord(record())).not.toBeNull();
    expect(readRecord(null)).toBeNull();
    expect(readRecord({ ...record(), seed: 1234 })).toBeNull();
    expect(readRecord({ ...record(), mc: -1 })).toBeNull();
    expect(readRecord({ ...record(), criteria: 'nope' })).toBeNull();
  });

  it('trims an over-long note rather than refusing the record', () => {
    const out = readRecord({ ...record(), note: 'y'.repeat(200) });
    expect(out?.note?.length).toBe(40);
  });
});
