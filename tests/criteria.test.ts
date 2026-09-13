import { describe, expect, it } from 'vitest';

import { STRUCT, TRAIT } from '../src/data/structures';
import { BIOME } from '../src/data/biomes';
import { distance, encodeCriteria, encodeCriterion } from '../src/search/criteria';

describe('criteria encoding', () => {
  it('treats "Any" as no constraint', () => {
    const e = encodeCriterion({ structure: STRUCT.Village, variants: { biome: null, abandoned: null } });
    expect(e).toEqual({ type: STRUCT.Village, biome: -1, traitReq: 0, traitMask: 0 });
  });

  it('encodes the village biome constraint', () => {
    const e = encodeCriterion({ structure: STRUCT.Village, variants: { biome: 'savanna' } });
    expect(e.biome).toBe(BIOME.savanna);
  });

  it('combines a biome and a trait constraint', () => {
    const e = encodeCriterion({
      structure: STRUCT.Village,
      variants: { biome: 'taiga', abandoned: 'yes' },
    });
    expect(e.biome).toBe(BIOME.taiga);
    expect(e.traitMask).toBe(TRAIT.abandoned);
    expect(e.traitReq).toBe(TRAIT.abandoned);
  });

  it('encodes a negative trait as masked-but-not-required', () => {
    const e = encodeCriterion({ structure: STRUCT.Village, variants: { abandoned: 'no' } });
    expect(e.traitMask).toBe(TRAIT.abandoned);
    expect(e.traitReq).toBe(0);
  });

  it('ignores variants on structures that have none', () => {
    const e = encodeCriterion({ structure: STRUCT.Monument, variants: { nope: 'x' } });
    expect(e).toEqual({ type: STRUCT.Monument, biome: -1, traitReq: 0, traitMask: 0 });
  });

  it('packs criteria four ints at a time', () => {
    const buf = encodeCriteria([
      { structure: STRUCT.Village, variants: { biome: 'desert' } },
      { structure: STRUCT.Ruined_Portal, variants: { shape: 'giant' } },
    ]);
    expect(buf.length).toBe(8);
    expect([...buf.slice(0, 4)]).toEqual([STRUCT.Village, BIOME.desert, 0, 0]);
    expect([...buf.slice(4, 8)]).toEqual([STRUCT.Ruined_Portal, -1, TRAIT.giant, TRAIT.giant]);
  });
});

describe('distance', () => {
  it('is euclidean', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(-100, -100, -100, -100)).toBe(0);
  });
});
