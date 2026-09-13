/**
 * Integration tests against the real WASM core. These need the module to be
 * built first (`npm run build:wasm`).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { BIOME } from '../src/data/biomes';
import { STRUCT } from '../src/data/structures';
import { loadModule } from './helpers';

const MC_1_16 = 20;
const MC_1_18 = 22;
const MC_1_19_2 = 23;
const MC_1_20 = 25;
const MC_1_21_1 = 26;

const MAX_OUT = 64;

let M: any;
let maxCrit = 16;
let critPtr = 0;
let seedsPtr = 0;
let dataPtr = 0;
let spawnPtr = 0;

interface Hit {
  x: number;
  z: number;
  biome: number;
  dim: number;
}

interface Found {
  seed: bigint;
  spawnX: number;
  spawnZ: number;
  hits: Hit[];
}

/** Runs a search directly against the WASM exports. */
function search(
  mc: number,
  radius: number,
  target: number,
  crits: number[][],
  start: bigint,
  count: number,
): Found[] {
  const flat = crits.flatMap((c) => [c[0]!, c[1] ?? -1, c[2] ?? 0, c[3] ?? 0]);
  M.HEAP32.set(flat, critPtr >> 2);
  const rc = M._sf_configure(mc, radius, target, critPtr, crits.length);
  expect(rc).toBe(crits.length);

  const n = M._sf_run(start, count, seedsPtr, dataPtr, spawnPtr, MAX_OUT);
  const seeds = new BigUint64Array(M.HEAPU8.buffer, seedsPtr, MAX_OUT);
  const out: Found[] = [];
  for (let i = 0; i < n; i++) {
    const hits: Hit[] = [];
    for (let k = 0; k < crits.length; k++) {
      const b = (dataPtr >> 2) + (i * maxCrit + k) * 4;
      hits.push({ x: M.HEAP32[b], z: M.HEAP32[b + 1], biome: M.HEAP32[b + 2], dim: M.HEAP32[b + 3] });
    }
    out.push({
      seed: seeds[i]!,
      spawnX: M.HEAP32[(spawnPtr >> 2) + i * 2],
      spawnZ: M.HEAP32[(spawnPtr >> 2) + i * 2 + 1],
      hits,
    });
  }
  return out;
}

beforeAll(async () => {
  M = await loadModule();
  maxCrit = M._sf_max_crit();
  critPtr = M._malloc(maxCrit * 16);
  seedsPtr = M._malloc(MAX_OUT * 8);
  dataPtr = M._malloc(MAX_OUT * maxCrit * 16);
  spawnPtr = M._malloc(MAX_OUT * 8);
});

describe('version gating', () => {
  it('matches the structures that exist in each version', () => {
    expect(M._sf_supported(STRUCT.Ancient_City, MC_1_18)).toBe(0);
    expect(M._sf_supported(STRUCT.Ancient_City, MC_1_19_2)).not.toBe(0);

    expect(M._sf_supported(STRUCT.Trial_Chambers, MC_1_20)).toBe(0);
    expect(M._sf_supported(STRUCT.Trial_Chambers, MC_1_21_1)).not.toBe(0);

    expect(M._sf_supported(STRUCT.Bastion, MC_1_16)).not.toBe(0);
    expect(M._sf_supported(STRUCT.Bastion, 18 /* 1.15 */)).toBe(0);

    expect(M._sf_supported(STRUCT.Village, MC_1_21_1)).not.toBe(0);
    expect(M._sf_supported(STRUCT.Stronghold, MC_1_21_1)).not.toBe(0);
  });

  it('reports the village region grid size', () => {
    // Villages use a 34 chunk region grid from 1.18 onwards, 32 before that.
    expect(M._sf_region_size(STRUCT.Village, MC_1_21_1)).toBe(34);
    expect(M._sf_region_size(STRUCT.Village, MC_1_16)).toBe(32);
  });
});

describe('distance filtering', () => {
  it('keeps every hit inside the radius', () => {
    const radius = 400;
    const found = search(MC_1_21_1, radius, 0, [[STRUCT.Village], [STRUCT.Ruined_Portal]], 0n, 50_000);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      for (const h of f.hits) {
        expect(Math.hypot(h.x, h.z)).toBeLessThanOrEqual(radius);
      }
    }
  });

  it('measures nether structures in nether coordinates', () => {
    const radius = 300;
    const found = search(MC_1_21_1, radius, 0, [[STRUCT.Fortress]], 0n, 20_000);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.hits[0]!.dim).toBe(-1);
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThanOrEqual(radius);
    }
  });
});

describe('variant filters', () => {
  it('returns only villages of the requested biome', () => {
    for (const [name, id] of [
      ['plains', BIOME.plains],
      ['desert', BIOME.desert],
      ['savanna', BIOME.savanna],
      ['taiga', BIOME.taiga],
      ['snowy', BIOME.snowy_tundra],
    ] as const) {
      const found = search(MC_1_21_1, 600, 0, [[STRUCT.Village, id]], 0n, 200_000);
      expect(found.length, `no ${name} village found`).toBeGreaterThan(0);
      for (const f of found) expect(f.hits[0]!.biome).toBe(id);
    }
  });
});

describe('multi-structure AND semantics', () => {
  it('only returns seeds that satisfy every criterion on its own', () => {
    const radius = 500;
    const start = 1_000_000n;
    const count = 30_000;

    const both = search(MC_1_21_1, radius, 0, [[STRUCT.Village], [STRUCT.Outpost]], start, count);
    const villages = new Set(
      search(MC_1_21_1, radius, 0, [[STRUCT.Village]], start, count).map((f) => f.seed),
    );
    const outposts = new Set(
      search(MC_1_21_1, radius, 0, [[STRUCT.Outpost]], start, count).map((f) => f.seed),
    );

    expect(both.length).toBeGreaterThan(0);
    for (const f of both) {
      // Both single-structure searches stop at MAX_OUT results, so only check
      // seeds that fall inside the range those searches actually covered.
      if (f.seed <= [...villages].at(-1)! && f.seed <= [...outposts].at(-1)!) {
        expect(villages.has(f.seed)).toBe(true);
        expect(outposts.has(f.seed)).toBe(true);
      }
    }
  });
});

describe('determinism', () => {
  it('returns the same seeds for the same query', () => {
    const a = search(MC_1_21_1, 450, 1, [[STRUCT.Village], [STRUCT.Ruined_Portal]], 777n, 20_000);
    const b = search(MC_1_21_1, 450, 1, [[STRUCT.Village], [STRUCT.Ruined_Portal]], 777n, 20_000);
    expect(a.map((f) => f.seed.toString())).toEqual(b.map((f) => f.seed.toString()));
    expect(a.length).toBeGreaterThan(0);
  });

  it('reports a spawn point that the distances are relative to', () => {
    const radius = 500;
    const found = search(MC_1_21_1, radius, 1, [[STRUCT.Village]], 12_345n, 20_000);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      const h = f.hits[0]!;
      expect(Math.hypot(h.x - f.spawnX, h.z - f.spawnZ)).toBeLessThanOrEqual(radius);
    }
  });
});
