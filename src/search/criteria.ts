/** Encodes UI criteria into the flat int32 layout that `sf_configure` reads. */

import { structureById } from '../data/structures';
import type { Criterion } from './types';

export interface EncodedCriterion {
  type: number;
  biome: number;
  traitReq: number;
  traitMask: number;
}

/**
 * Folds every selected variant option of one structure into a single
 * (biome, traitReq, traitMask) triple. Options left on "Any" contribute
 * nothing, which is what makes "Any" mean "don't care" rather than
 * "must not have".
 */
export function encodeCriterion(c: Criterion): EncodedCriterion {
  const def = structureById(c.structure);
  const out: EncodedCriterion = { type: c.structure, biome: -1, traitReq: 0, traitMask: 0 };
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
  }
  return out;
}

export function encodeCriteria(criteria: readonly Criterion[]): Int32Array {
  const buf = new Int32Array(criteria.length * 4);
  criteria.forEach((c, i) => {
    const e = encodeCriterion(c);
    buf[i * 4 + 0] = e.type;
    buf[i * 4 + 1] = e.biome;
    buf[i * 4 + 2] = e.traitReq;
    buf[i * 4 + 3] = e.traitMask;
  });
  return buf;
}

/** Euclidean distance in blocks, rounded to one decimal. */
export function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.round(Math.hypot(ax - bx, az - bz) * 10) / 10;
}
