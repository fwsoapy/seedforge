import { describe, expect, it } from 'vitest';

import { STRUCT, TRAIT } from '../src/data/structures';
import { BIOME } from '../src/data/biomes';
import { CRIT_INTS, distance, encodeCriteria, encodeCriterion, encodeRules } from '../src/search/criteria';
import { KIND } from '../src/search/types';
import { BIOME as B, biomeById } from '../src/data/biomes';

describe('criteria encoding', () => {
  it('treats "Any" as no constraint', () => {
    const e = encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: { biome: null, abandoned: null }, radius: 500 });
    expect(e).toMatchObject({ kind: KIND.structure, type: STRUCT.Village, biome: -1, traitReq: 0, traitMask: 0 });
  });

  it('encodes the village biome constraint', () => {
    const e = encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: { biome: 'savanna' }, radius: 500 });
    expect(e.biome).toBe(BIOME.savanna);
  });

  it('combines a biome and a trait constraint', () => {
    const e = encodeCriterion({
      kind: KIND.structure,
      id: STRUCT.Village,
      variants: { biome: 'taiga', abandoned: 'yes' },
      radius: 500,
    });
    expect(e.biome).toBe(BIOME.taiga);
    expect(e.traitMask).toBe(TRAIT.abandoned);
    expect(e.traitReq).toBe(TRAIT.abandoned);
  });

  it('encodes the experimental size buckets as footprint bounds', () => {
    expect(encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: { size: 'small' }, radius: 500 })).toMatchObject({
      areaMin: 0,
      areaMax: 100,
    });
    expect(encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: { size: 'large' }, radius: 500 })).toMatchObject({
      areaMin: 201,
      areaMax: 0,
    });
  });

  it('encodes a negative trait as masked-but-not-required', () => {
    const e = encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: { abandoned: 'no' }, radius: 500 });
    expect(e.traitMask).toBe(TRAIT.abandoned);
    expect(e.traitReq).toBe(0);
  });

  it('ignores variants on structures that have none', () => {
    const e = encodeCriterion({ kind: KIND.structure, id: STRUCT.Monument, variants: { nope: 'x' }, radius: 500 });
    expect(e).toMatchObject({ kind: KIND.structure, type: STRUCT.Monument, biome: -1, traitReq: 0, traitMask: 0 });
  });

  it('packs criteria four ints at a time', () => {
    const buf = encodeCriteria([
      { kind: KIND.structure, id: STRUCT.Village, variants: { biome: 'desert' }, radius: 500 },
      { kind: KIND.structure, id: STRUCT.Ruined_Portal, variants: { portalType: 'giant' }, radius: 300 },
    ]);
    expect(buf.length).toBe(2 * CRIT_INTS);
    expect([...buf.slice(0, CRIT_INTS)]).toEqual([
      KIND.structure, STRUCT.Village, BIOME.desert, 0, 0, 0, 0, 0, 500, -1,
    ]);
    expect([...buf.slice(CRIT_INTS, 2 * CRIT_INTS)]).toEqual([
      KIND.structure, STRUCT.Ruined_Portal, -1, TRAIT.giant, TRAIT.giant, 0, 0, 0, 300, -1,
    ]);
  });
});

describe('ruined portal type and placement are independent', () => {
  const portal = (variants: Record<string, string | null>) =>
    encodeCriterion({ kind: KIND.structure, id: STRUCT.Ruined_Portal, variants, radius: 500 });

  it('constrains only the group that was set', () => {
    const typeOnly = portal({ portalType: 'giant', portalPlacement: null });
    expect(typeOnly.traitMask).toBe(TRAIT.giant);

    const placeOnly = portal({ portalType: null, portalPlacement: 'buried' });
    expect(placeOnly.traitMask).toBe(TRAIT.underground);
    expect(placeOnly.traitReq).toBe(TRAIT.underground);
  });

  it('combines both when both are set', () => {
    const both = portal({ portalType: 'normal', portalPlacement: 'surface' });
    expect(both.traitMask).toBe(TRAIT.giant | TRAIT.underground);
    expect(both.traitReq).toBe(0);
  });

  it('carries the template index as a subtype', () => {
    expect(portal({ portalTemplate: '7' }).subtype).toBe(7);
    expect(portal({ portalTemplate: null }).subtype).toBe(-1);
  });
});

describe('bastion and stronghold subtypes', () => {
  it('maps the four bastion types onto starting piece indices', () => {
    const bastion = (v: string) =>
      encodeCriterion({ kind: KIND.structure, id: STRUCT.Bastion, variants: { bastionType: v }, radius: 500 });
    expect(bastion('housing').subtype).toBe(0);
    expect(bastion('stables').subtype).toBe(1);
    expect(bastion('treasure').subtype).toBe(2);
    expect(bastion('bridge').subtype).toBe(3);
  });

  it('maps stronghold rings onto their ring number', () => {
    const sh = (v: string | null) =>
      encodeCriterion({ kind: KIND.structure, id: STRUCT.Stronghold, variants: { ring: v }, radius: 3000 });
    expect(sh('1').subtype).toBe(1);
    expect(sh('3').subtype).toBe(3);
    expect(sh(null).subtype).toBe(-1);
  });
});

describe('proximity rules', () => {
  it('packs three ints per rule', () => {
    const buf = encodeRules([
      { a: 0, b: 1, maxDist: 120 },
      { a: 1, b: 2, maxDist: 64 },
    ]);
    expect([...buf]).toEqual([0, 1, 120, 1, 2, 64]);
  });

  it('clamps a negative distance to zero', () => {
    expect([...encodeRules([{ a: 0, b: 1, maxDist: -5 }])]).toEqual([0, 1, 0]);
  });
});

describe('per-criterion radius', () => {
  it('is carried through the encoding', () => {
    const e = encodeCriterion({ kind: KIND.structure, id: STRUCT.Village, variants: {}, radius: 137 });
    expect(e.radius).toBe(137);
  });
});

describe('biome criteria', () => {
  it('carries the biome id and its sampling height', () => {
    const e = encodeCriterion({ kind: KIND.biome, id: B.deep_dark, variants: {}, radius: 500 });
    expect(e.kind).toBe(KIND.biome);
    expect(e.biome).toBe(B.deep_dark);
    expect(e.sampleY).toBe(biomeById(B.deep_dark)!.sampleY);
    expect(e.sampleY).toBeLessThan(0); // cave biome, sampled underground
  });

  it('samples surface biomes above sea level', () => {
    const e = encodeCriterion({ kind: KIND.biome, id: B.mushroom_fields, variants: {}, radius: 500 });
    expect(e.sampleY).toBeGreaterThan(0);
  });
});

describe('distance', () => {
  it('is euclidean', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
    expect(distance(-100, -100, -100, -100)).toBe(0);
  });
});
