/**
 * Saved presets come back out of localStorage, which is untrusted input: it
 * can be hand-edited, stale, or corrupt. These cover what survives that trip,
 * and that nothing stored can touch the built-in four.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CUSTOM_PRESETS,
  MAX_PRESET_NAME,
  loadCustomPresets,
  newPresetKey,
  saveCustomPresets,
  summarise,
  type CustomPreset,
} from '../src/data/custom-presets';
import { PRESETS } from '../src/data/presets';
import { KIND } from '../src/search/types';

const KEY = 'seedforge:presets';

/** A minimal in-memory localStorage, since this runs under Node. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

/** Deliberately accepts junk, since that is what the loader has to survive. */
const preset = (over: Record<string, unknown> = {}): CustomPreset => ({
  key: 'custom-1',
  name: 'Mine',
  blurb: '1 structure',
  criteria: [{ kind: KIND.structure, id: 5, radius: 200 }],
  rules: [],
  custom: true,
  ...over,
} as CustomPreset);

let store: Map<string, string>;
beforeEach(() => {
  store = installStorage();
});

describe('saved presets', () => {
  it('round-trips a preset', () => {
    const p = preset({
      criteria: [
        { kind: KIND.structure, id: 5, radius: 100, variants: { biome: 'plains' } },
        { kind: KIND.biome, id: 4, radius: 300 },
      ],
      rules: [{ a: [KIND.structure, 5], b: [KIND.biome, 4], maxDist: 250 }],
    });
    expect(saveCustomPresets([p])).toBe(true);
    expect(loadCustomPresets()).toEqual([p]);
  });

  it('returns nothing when there is nothing stored', () => {
    expect(loadCustomPresets()).toEqual([]);
  });

  it('survives junk in storage instead of throwing', () => {
    for (const junk of ['', 'not json', '{}', 'null', '42', '"a string"', '[1,2,3]']) {
      store.set(KEY, junk);
      expect(loadCustomPresets()).toEqual([]);
    }
  });

  it('drops entries that are missing or malformed, keeping the good ones', () => {
    store.set(KEY, JSON.stringify([
      preset({ key: 'a', name: 'Good' }),
      { key: 'b' },                                   // no name or criteria
      preset({ key: 'c', name: '   ' }),              // blank name
      preset({ key: 'd', criteria: [] }),             // nothing selected
      preset({ key: 'e', criteria: [{ kind: 99, id: 5, radius: 10 }] }),  // bad kind
      preset({ key: 'f', criteria: [{ kind: 0, id: 5, radius: -1 }] }),   // bad radius
      preset({ key: 'g', name: 'Also good' }),
    ]));
    expect(loadCustomPresets().map((p) => p.name)).toEqual(['Good', 'Also good']);
  });

  it('drops a rule that is malformed but keeps the preset', () => {
    store.set(KEY, JSON.stringify([
      preset({ rules: [{ a: [0, 5], b: [0, 9], maxDist: 100 }, { a: [0, 5], maxDist: 100 }] }),
    ]));
    const [p] = loadCustomPresets();
    expect(p!.rules).toEqual([{ a: [KIND.structure, 5], b: [KIND.structure, 9], maxDist: 100 }]);
  });

  it('ignores variant values that are not strings', () => {
    store.set(KEY, JSON.stringify([
      preset({ criteria: [{ kind: 0, id: 5, radius: 100, variants: { biome: 'plains', size: null, x: 7 } }] }),
    ]));
    expect(loadCustomPresets()[0]!.criteria[0]!.variants).toEqual({ biome: 'plains' });
  });

  it('never keeps more than the cap, reading or writing', () => {
    const many = Array.from({ length: 20 }, (_, i) => preset({ key: `k${i}`, name: `P${i}` }));
    saveCustomPresets(many);
    expect(JSON.parse(store.get(KEY)!).length).toBe(MAX_CUSTOM_PRESETS);
    store.set(KEY, JSON.stringify(many));
    expect(loadCustomPresets().length).toBe(MAX_CUSTOM_PRESETS);
  });

  it('drops duplicate keys', () => {
    store.set(KEY, JSON.stringify([preset({ key: 'same', name: 'First' }), preset({ key: 'same', name: 'Second' })]));
    expect(loadCustomPresets().map((p) => p.name)).toEqual(['First']);
  });

  it('trims a long name rather than refusing it', () => {
    store.set(KEY, JSON.stringify([preset({ name: 'x'.repeat(100) })]));
    expect(loadCustomPresets()[0]!.name.length).toBe(MAX_PRESET_NAME);
  });

  it('reports failure rather than throwing when storage refuses', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
    });
    expect(saveCustomPresets([preset()])).toBe(false);
    expect(loadCustomPresets()).toEqual([]);
  });

  it('survives storage that throws on read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(loadCustomPresets()).toEqual([]);
  });

  it('gives out keys that cannot collide with a built-in', () => {
    const builtIn = new Set(PRESETS.map((p) => p.key));
    for (let i = 0; i < 200; i++) expect(builtIn.has(newPresetKey())).toBe(false);
  });
});

describe('the built-in presets are not editable', () => {
  it('refuses to load a stored preset claiming a built-in key', () => {
    store.set(KEY, JSON.stringify(
      PRESETS.map((p) => preset({ key: p.key, name: 'Impostor' })),
    ));
    expect(loadCustomPresets()).toEqual([]);
  });

  it('refuses to write one, even if asked directly', () => {
    const impostor = preset({ key: PRESETS[0]!.key, name: 'Impostor' });
    expect(saveCustomPresets([impostor, preset({ key: 'mine', name: 'Mine' })])).toBe(true);
    expect(loadCustomPresets().map((p) => p.name)).toEqual(['Mine']);
  });

  it('leaves the built-in list itself untouched by any of this', () => {
    const before = JSON.stringify(PRESETS);
    store.set(KEY, JSON.stringify([preset({ key: PRESETS[1]!.key, name: 'Impostor' })]));
    loadCustomPresets();
    saveCustomPresets([preset()]);
    expect(JSON.stringify(PRESETS)).toBe(before);
  });
});

describe('summarise', () => {
  it('counts what is in a preset', () => {
    expect(summarise([{ kind: KIND.structure, id: 5, radius: 1 }], [])).toBe('1 structure');
    expect(summarise(
      [{ kind: KIND.structure, id: 5, radius: 1 }, { kind: KIND.biome, id: 4, radius: 1 }],
      [{ a: [KIND.structure, 5], b: [KIND.biome, 4], maxDist: 10 }],
    )).toBe('1 structure, 1 biome, 1 rule');
  });
});
