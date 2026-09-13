/** Encodes UI criteria into the flat int32 layout that `sf_configure` reads. */

import { biomeById } from '../data/biomes';
import { structureById } from '../data/structures';
import { KIND, type Criterion } from './types';

/** Must match SF_CRIT_INTS in wasm/bindings.c. */
export const CRIT_INTS = 8;

export interface EncodedCriterion {
  kind: number;
  type: number;
  biome: number;
  traitReq: number;
  traitMask: number;
  areaMin: number;
  areaMax: number;
  sampleY: number;
}

/**
 * Folds every selected variant option of one structure into a single
 * (biome, traitReq, traitMask) triple. Options left on "Any" contribute
 * nothing, which is what makes "Any" mean "don't care" rather than
 * "must not have".
 */
export function encodeCriterion(c: Criterion): EncodedCriterion {
  const out: EncodedCriterion = {
    kind: c.kind,
    type: c.id,
    biome: -1,
    traitReq: 0,
    traitMask: 0,
    areaMin: 0,
    areaMax: 0,
    sampleY: 0,
  };

  if (c.kind === KIND.biome) {
    out.biome = c.id;
    out.sampleY = biomeById(c.id)?.sampleY ?? 63;
    return out;
  }

  const def = structureById(c.id);
  if (!def?.variants) return out;

  for (const group of def.variants) {
    const selected = c.variants[group.key] ?? null;
    if (selected === null) continue;
    const opt = group.options.find((o) => o.value === selected);
    if (!opt) continue;
    if (opt.biome !== undefined) out.biome = opt.biome;
    if (opt.traitMask) {
      out.traitMask |= opt.traitMask;
      out.traitReq |= opt.traitReq ?? 0;
    }
    if (opt.areaMin !== undefined) out.areaMin = opt.areaMin;
    if (opt.areaMax !== undefined) out.areaMax = opt.areaMax;
  }
  return out;
}

export function encodeCriteria(criteria: readonly Criterion[]): Int32Array {
  const buf = new Int32Array(criteria.length * CRIT_INTS);
  criteria.forEach((c, i) => {
    const e = encodeCriterion(c);
    buf[i * CRIT_INTS + 0] = e.kind;
    buf[i * CRIT_INTS + 1] = e.type;
    buf[i * CRIT_INTS + 2] = e.biome;
    buf[i * CRIT_INTS + 3] = e.traitReq;
    buf[i * CRIT_INTS + 4] = e.traitMask;
    buf[i * CRIT_INTS + 5] = e.areaMin;
    buf[i * CRIT_INTS + 6] = e.areaMax;
    buf[i * CRIT_INTS + 7] = e.sampleY;
  });
  return buf;
}

/** Euclidean distance in blocks, rounded to one decimal. */
export function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.round(Math.hypot(ax - bx, az - bz) * 10) / 10;
}
