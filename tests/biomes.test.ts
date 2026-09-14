import { describe, expect, it } from 'vitest';

import { BIOME_GROUPS, SEARCHABLE_BIOMES, biomeById } from '../src/data/biomes';

describe('biome catalogue', () => {
  it('has no duplicate ids', () => {
    const ids = SEARCHABLE_BIOMES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts every biome in a real group', () => {
    const keys = new Set(BIOME_GROUPS.map((g) => g.key));
    for (const b of SEARCHABLE_BIOMES) {
      expect(keys.has(b.group), `${b.name} has group ${b.group}`).toBe(true);
    }
  });

  it('samples cave biomes underground and everything else above sea level', () => {
    // Biomes are three-dimensional from 1.18 on. A cave biome sampled at the
    // surface, or a peak sampled at y=63, simply never turns up - the search
    // looks like it works and silently returns nothing.
    for (const b of SEARCHABLE_BIOMES) {
      if (b.group === 'cave') {
        expect(b.sampleY, `${b.name} should be sampled underground`).toBeLessThan(0);
      } else {
        expect(b.sampleY, `${b.name} should be sampled above sea level`).toBeGreaterThan(0);
      }
    }
  });

  it('samples peaks high enough to exist', () => {
    for (const name of ['Jagged peaks', 'Frozen peaks']) {
      const b = SEARCHABLE_BIOMES.find((x) => x.name === name)!;
      expect(b.sampleY, `${name}`).toBeGreaterThanOrEqual(150);
    }
  });

  it('looks up by id', () => {
    const first = SEARCHABLE_BIOMES[0]!;
    expect(biomeById(first.id)?.name).toBe(first.name);
    expect(biomeById(-999)).toBeUndefined();
  });

  it('covers the basics people actually search for', () => {
    const names = SEARCHABLE_BIOMES.map((b) => b.name);
    for (const expected of [
      'Plains', 'Forest', 'Birch forest', 'Dark forest', 'Taiga', 'Desert',
      'Savanna', 'Swamp', 'Jungle', 'Ocean', 'River', 'Beach', 'Snowy plains',
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
  });
});
