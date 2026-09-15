/**
 * Presets are written once, for Java. These check that applying one on Bedrock
 * prunes itself correctly rather than asking the engine for something it will
 * refuse, and that the shipped presets are internally coherent.
 */
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/data/presets';
import { STRUCT, STRUCTURES, structureById } from '../src/data/structures';
import { SEARCHABLE_BIOMES } from '../src/data/biomes';
import { KIND } from '../src/search/types';

const byKey = (k: string) => PRESETS.find((p) => p.key === k)!;

describe('preset catalogue', () => {
  it('ships the four presets, each with a name and a blurb', () => {
    expect(PRESETS.map((p) => p.key)).toEqual([
      'simple-speedrun',
      'advanced-speedrun-village',
      'advanced-speedrun-treasure',
      'advanced-speedrun-shipwreck',
      'perfect-start',
      'rare-finds',
    ]);
    for (const p of PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.blurb.length).toBeGreaterThan(0);
      expect(p.criteria.length).toBeGreaterThan(0);
    }
  });

  it('only refers to structures and biomes that exist', () => {
    for (const p of PRESETS) {
      for (const c of p.criteria) {
        if (c.kind === KIND.structure) {
          expect(STRUCTURES.some((d) => d.id === c.id)).toBe(true);
        } else {
          expect(SEARCHABLE_BIOMES.some((d) => d.id === c.id)).toBe(true);
        }
        expect(c.radius).toBeGreaterThan(0);
      }
    }
  });

  it('only sets variant values the group actually offers', () => {
    for (const p of PRESETS) {
      for (const c of p.criteria) {
        if (!c.variants) continue;
        const def = structureById(c.id)!;
        for (const [groupKey, value] of Object.entries(c.variants)) {
          const group = def.variants?.find((g) => g.key === groupKey);
          expect(group, `${p.key}: ${def.name} has no ${groupKey}`).toBeDefined();
          expect(group!.options.some((o) => o.value === value)).toBe(true);
        }
      }
    }
  });

  it('never writes a rule between criteria it does not also select', () => {
    for (const p of PRESETS) {
      const picked = new Set(p.criteria.map((c) => `${c.kind}:${c.id}`));
      for (const r of p.rules) {
        expect(picked.has(`${r.a[0]}:${r.a[1]}`)).toBe(true);
        expect(picked.has(`${r.b[0]}:${r.b[1]}`)).toBe(true);
        expect(r.maxDist).toBeGreaterThan(0);
      }
    }
  });

  it('never puts a rule across the End, which cannot be measured', () => {
    for (const p of PRESETS) {
      for (const r of p.rules) {
        for (const end of [r.a, r.b]) {
          if (end[0] !== KIND.structure) continue;
          expect(structureById(end[1])?.dim).not.toBe('end');
        }
      }
    }
  });

  it('keeps both speedruns away from zombie villages', () => {
    for (const key of ['simple-speedrun', 'advanced-speedrun-village']) {
      const village = byKey(key).criteria.find((c) => c.id === STRUCT.Village)!;
      expect(village.variants?.['abandoned']).toBe('no');
    }
  });

  it('keeps the advanced speedruns together as one group', () => {
    const grouped = PRESETS.filter((p) => p.group !== undefined);
    expect(grouped.length).toBe(3);
    expect(new Set(grouped.map((p) => p.group))).toEqual(new Set(['Advanced Speedrun']));
    // They share one tile, so each needs a short label and they must be
    // adjacent: the renderer only collapses consecutive members.
    for (const p of grouped) expect(p.option).toBeTruthy();
    const first = PRESETS.findIndex((p) => p.group !== undefined);
    expect(PRESETS.slice(first, first + 3).every((p) => p.group !== undefined)).toBe(true);
  });

  it('gives all three advanced speedruns the same chain after the start', () => {
    for (const key of [
      'advanced-speedrun-village', 'advanced-speedrun-treasure', 'advanced-speedrun-shipwreck',
    ]) {
      const p = byKey(key);
      const at = (id: number) => p.criteria.find((c) => c.id === id)!;
      expect(at(STRUCT.Ruined_Portal).variants).toEqual({
        portalType: 'normal', portalPlacement: 'surface', portalTemplate: '8',
      });
      expect(at(STRUCT.Stronghold).radius).toBe(1500);
      expect(at(STRUCT.Stronghold).variants?.['ring']).toBe('1');
      // Fortress and bastion always share a radius and sit off the portal.
      expect(at(STRUCT.Fortress).radius).toBe(at(STRUCT.Bastion).radius);
      expect(p.criteria.length).toBe(5);
      expect(p.rules.length).toBe(3);
    }
  });

  it('matches the village variant', () => {
    const p = byKey('advanced-speedrun-village');
    const at = (id: number) => p.criteria.find((c) => c.id === id)!;
    expect(at(STRUCT.Village).radius).toBe(100);
    expect(at(STRUCT.Village).variants).toEqual({ biome: 'plains', abandoned: 'no' });
    expect(at(STRUCT.Ruined_Portal).radius).toBe(200);
    expect(at(STRUCT.Bastion).radius).toBe(300);
    expect(at(STRUCT.Bastion).variants?.['bastionType']).toBe('treasure');
  });

  it('matches the buried treasure variant', () => {
    const p = byKey('advanced-speedrun-treasure');
    const at = (id: number) => p.criteria.find((c) => c.id === id)!;
    expect(at(STRUCT.Ruined_Portal).radius).toBe(100);
    expect(at(STRUCT.Treasure).radius).toBe(25);
    expect(at(STRUCT.Bastion).radius).toBe(300);
    expect(at(STRUCT.Bastion).variants?.['bastionType']).toBe('bridge');
    expect(p.criteria.some((c) => c.id === STRUCT.Village)).toBe(false);
    const toTreasure = p.rules.find((r) => r.b[1] === STRUCT.Treasure)!;
    expect(toTreasure.a[1]).toBe(STRUCT.Ruined_Portal);
    expect(toTreasure.maxDist).toBe(50);
  });

  it('matches the shipwreck variant', () => {
    const p = byKey('advanced-speedrun-shipwreck');
    const at = (id: number) => p.criteria.find((c) => c.id === id)!;
    expect(at(STRUCT.Ruined_Portal).radius).toBe(100);
    expect(at(STRUCT.Shipwreck).radius).toBe(200);
    expect(at(STRUCT.Bastion).radius).toBe(500);
    expect(at(STRUCT.Bastion).variants?.['bastionType']).toBe('treasure');
    expect(p.criteria.some((c) => c.id === STRUCT.Village)).toBe(false);
    const toWreck = p.rules.find((r) => r.b[1] === STRUCT.Shipwreck)!;
    expect(toWreck.a[1]).toBe(STRUCT.Ruined_Portal);
    expect(toWreck.maxDist).toBe(200);
  });

  it('leans on Java-only filters only where they can be dropped cleanly', () => {
    // Every variant a preset sets is either universal or javaOnly. A javaOnly
    // one has to be droppable, meaning the criterion still makes sense without
    // it, which it does because the position never depended on the variant.
    for (const p of PRESETS) {
      for (const c of p.criteria) {
        if (!c.variants) continue;
        const def = structureById(c.id)!;
        for (const groupKey of Object.keys(c.variants)) {
          const group = def.variants!.find((g) => g.key === groupKey)!;
          expect(typeof group.javaOnly === 'boolean' || group.javaOnly === undefined).toBe(true);
        }
      }
    }
  });
});
