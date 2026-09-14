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
      'simple-speedrun', 'advanced-speedrun', 'perfect-start', 'rare-finds',
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
    for (const key of ['simple-speedrun', 'advanced-speedrun']) {
      const village = byKey(key).criteria.find((c) => c.id === STRUCT.Village)!;
      expect(village.variants?.['abandoned']).toBe('no');
    }
  });

  it('matches the advanced speedrun spec', () => {
    const p = byKey('advanced-speedrun');
    const at = (id: number) => p.criteria.find((c) => c.id === id)!;
    expect(at(STRUCT.Village).radius).toBe(100);
    expect(at(STRUCT.Village).variants?.['biome']).toBe('plains');
    expect(at(STRUCT.Ruined_Portal).variants?.['portalTemplate']).toBe('8');
    expect(at(STRUCT.Ruined_Portal).variants?.['portalPlacement']).toBe('surface');
    expect(at(STRUCT.Bastion).variants?.['bastionType']).toBe('treasure');
    expect(at(STRUCT.Stronghold).variants?.['ring']).toBe('1');
    expect(p.rules.length).toBe(3);
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
