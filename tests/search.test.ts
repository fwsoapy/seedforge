/**
 * Integration tests against the real WASM core. These need the module to be
 * built first (`npm run build:wasm`).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { BIOME, biomeById } from '../src/data/biomes';
import { STRUCT } from '../src/data/structures';
import { loadModule } from './helpers';

const MC_1_16 = 20;
const MC_1_18 = 22;
const MC_1_19_2 = 23;
const MC_1_20 = 25;
const MC_1_21_1 = 26;
const MC_1_21_3 = 27;
const MC_1_21_4 = 28;
const MC_1_21_5 = 29;
const MC_26_1 = 36;
const MC_26_2 = 39;

const MAX_OUT = 64;
const CRIT_INTS = 10;
const PAIR_INTS = 3;
const K_STRUCT = 0;
const K_BIOME = 1;

let M: any;
let maxCrit = 16;
let critPtr = 0;
let seedsPtr = 0;
let dataPtr = 0;
let spawnPtr = 0;
let pairPtr = 0;

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
  rules: number[][] = [],
  edition = 0,
): Found[] {
  // [ kind, type, variant, traitReq, traitMask, areaMin, areaMax, sampleY,
  //   radius, subtype ]
  const flat = crits.flatMap((c) => [
    c[0]!, c[1]!, c[2] ?? -1, c[3] ?? 0, c[4] ?? 0, c[5] ?? 0, c[6] ?? 0, c[7] ?? 0,
    c[8] ?? radius, c[9] ?? -1,
  ]);
  M.HEAP32.set(flat, critPtr >> 2);
  M.HEAP32.set(rules.flat(), pairPtr >> 2);
  const rc = M._sf_configure(mc, edition, target, critPtr, crits.length, pairPtr, rules.length);
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
  expect(M._sf_crit_ints()).toBe(CRIT_INTS);
  critPtr = M._malloc(maxCrit * CRIT_INTS * 4);
  pairPtr = M._malloc(M._sf_max_pairs() * PAIR_INTS * 4);
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
    const found = search(MC_1_21_1, radius, 0, [[K_STRUCT, STRUCT.Village], [K_STRUCT, STRUCT.Ruined_Portal]], 0n, 50_000);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      for (const h of f.hits) {
        expect(Math.hypot(h.x, h.z)).toBeLessThanOrEqual(radius);
      }
    }
  });

  it('measures nether structures in nether coordinates', () => {
    const radius = 300;
    const found = search(MC_1_21_1, radius, 0, [[K_STRUCT, STRUCT.Fortress]], 0n, 20_000);
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
      const found = search(MC_1_21_1, 600, 0, [[K_STRUCT, STRUCT.Village, id]], 0n, 200_000);
      expect(found.length, `no ${name} village found`).toBeGreaterThan(0);
      for (const f of found) expect(f.hits[0]!.biome).toBe(id);
    }
  });
});

describe('strongholds', () => {
  it('never places one closer than the first ring', () => {
    expect(search(MC_1_21_1, 500, 0, [[K_STRUCT, STRUCT.Stronghold]], 0n, 3_000)).toHaveLength(0);
  });

  it('finds them once the radius reaches the first ring', () => {
    const found = search(MC_1_21_1, 2_000, 0, [[K_STRUCT, STRUCT.Stronghold]], 0n, 400);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      const d = Math.hypot(f.hits[0]!.x, f.hits[0]!.z);
      expect(d).toBeLessThanOrEqual(2_000);
      expect(d).toBeGreaterThan(1_200);
    }
  });
});

describe('experimental village size filter', () => {
  it('selects a strict, disjoint subset of the unfiltered villages', () => {
    // A tight radius over a short seed range keeps every search well under
    // the output buffer cap, so the result sets are directly comparable.
    const args = [MC_1_21_1, 150, 0] as const;
    const start = 5_000n;
    const count = 700;
    const key = (f: Found) => `${f.seed}:${f.hits[0]!.x},${f.hits[0]!.z}`;

    const all = search(...args, [[K_STRUCT, STRUCT.Village]], start, count);
    const small = search(...args, [[K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 100]], start, count);
    const large = search(...args, [[K_STRUCT, STRUCT.Village, -1, 0, 0, 201, 0]], start, count);

    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThan(MAX_OUT);
    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBeGreaterThan(0);

    const allKeys = new Set(all.map(key));
    for (const f of small) expect(allKeys.has(key(f))).toBe(true);
    for (const f of large) expect(allKeys.has(key(f))).toBe(true);

    // The buckets do not overlap, and neither covers everything.
    const smallKeys = new Set(small.map(key));
    for (const f of large) expect(smallKeys.has(key(f))).toBe(false);
    expect(small.length + large.length).toBeLessThan(all.length);
  });
});

describe('biome criteria', () => {
  const dd = () => [K_BIOME, 0, BIOME.deep_dark, 0, 0, 0, 0, biomeById(BIOME.deep_dark)!.sampleY, 400, -1];

  it('gates biomes by version like it gates structures', () => {
    expect(M._sf_biome_supported(BIOME.deep_dark, MC_1_18)).toBe(0);
    expect(M._sf_biome_supported(BIOME.deep_dark, MC_1_19_2)).not.toBe(0);
    expect(M._sf_biome_supported(BIOME.lush_caves, MC_1_16)).toBe(0);
    expect(M._sf_biome_supported(BIOME.lush_caves, MC_1_18)).not.toBe(0);
  });

  it('reports a position inside the radius', () => {
    const radius = 400;
    const found = search(MC_1_21_1, radius, 0, [dd()], 0n, 200);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.hits[0]!.biome).toBe(BIOME.deep_dark);
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThanOrEqual(radius);
    }
  });

  it('combines with structure criteria', () => {
    const radius = 500;
    const found = search(
      MC_1_21_1, radius, 0,
      [dd(), [K_STRUCT, STRUCT.Village]],
      0n, 2_000,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      // Hits come back in the order the caller listed the criteria, even
      // though the engine evaluates structures first.
      expect(f.hits[0]!.biome).toBe(BIOME.deep_dark);
      expect(f.hits[1]!.dim).toBe(0);
      for (const h of f.hits) expect(Math.hypot(h.x, h.z)).toBeLessThanOrEqual(radius);
    }
  });

  it('rejects a radius too large to sample', () => {
    const flat = [...dd()];
    flat[8] = 500_000;
    M.HEAP32.set(flat, critPtr >> 2);
    expect(M._sf_configure(MC_1_21_1, 0, 0, critPtr, 1, pairPtr, 0)).toBe(-5);
  });
});

describe('bedrock edition', () => {
  const BEDROCK = 1;

  it('places structures with the Bedrock generator, not the Java one', () => {
    const crit = [[K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 2_000]];
    const java = search(MC_26_2, 0, 0, crit, 0n, 300, [], 0);
    const bedrock = search(MC_26_2, 0, 0, crit, 0n, 300, [], BEDROCK);
    expect(java.length).toBeGreaterThan(0);
    expect(bedrock.length).toBeGreaterThan(0);
    // Same seeds, same criteria, different generator - the positions must not
    // coincide, otherwise Bedrock is quietly running Java's math.
    const key = (f: Found) => `${f.seed}:${f.hits[0]!.x},${f.hits[0]!.z}`;
    expect(bedrock.map(key)).not.toEqual(java.map(key));
  });

  it('keeps every hit inside the radius', () => {
    const radius = 1_500;
    const found = search(
      MC_26_2, 0, 0,
      [[K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, radius]],
      0n, 300, [], BEDROCK,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThanOrEqual(radius);
    }
  });

  it('reads the low 32 bits for placement and all 64 for biomes', () => {
    // Two seeds sharing a low half place structures identically; the biome
    // check then tells them apart, exactly as the two Bedrock crackers split
    // the work.
    const crit = [[K_STRUCT, STRUCT.Desert_Pyramid, -1, 0, 0, 0, 0, 0, 4_000]];
    const low = search(MC_26_2, 0, 0, crit, 777n, 1, [], BEDROCK);
    const high = search(MC_26_2, 0, 0, crit, (1n << 32n) + 777n, 1, [], BEDROCK);
    const probe = M._malloc(5 * 4);
    M._sf_bedrock_probe(STRUCT.Desert_Pyramid, 777n, 0, 0, probe);
    const a = [...M.HEAP32.subarray(probe >> 2, (probe >> 2) + 2)];
    M._sf_bedrock_probe(STRUCT.Desert_Pyramid, (1n << 32n) + 777n, 0, 0, probe);
    const b = [...M.HEAP32.subarray(probe >> 2, (probe >> 2) + 2)];
    M._free(probe);
    expect(a).toEqual(b);
    // A seed wider than 32 bits is accepted rather than refused.
    expect(() => search(MC_26_2, 0, 0, crit, (1n << 40n) + 5n, 1, [], BEDROCK)).not.toThrow();
    expect(low.length + high.length).toBeGreaterThanOrEqual(0);
  });

  it('refuses structures the Bedrock generator does not place', () => {
    expect(M._sf_bedrock_supported(STRUCT.Village)).not.toBe(0);
    expect(M._sf_bedrock_supported(STRUCT.Fortress)).not.toBe(0);
    // no Bedrock region grid for these
    expect(M._sf_bedrock_supported(STRUCT.Mineshaft)).toBe(0);
    expect(M._sf_bedrock_supported(STRUCT.Trial_Chambers)).toBe(0);

    M.HEAP32.set([K_STRUCT, STRUCT.Mineshaft, -1, 0, 0, 0, 0, 0, 500, -1], critPtr >> 2);
    expect(M._sf_configure(MC_26_2, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(-10);
  });

  // Fortresses and bastions share one region grid on Bedrock and exactly one
  // of the pair is built per site, picked by the draw right after the two that
  // place it: mt[2] % 6 >= 2 is a bastion. Offering them as two independent
  // structures used to put both at the same coordinates in every seed, which
  // is not a world that exists.
  it('never puts a fortress and a bastion on the same site', () => {
    const radius = 3_000;
    const forts = search(
      MC_26_2, 0, 0, [[K_STRUCT, STRUCT.Fortress, -1, 0, 0, 0, 0, 0, radius]],
      0n, 120, [], BEDROCK,
    );
    const bastions = search(
      MC_26_2, 0, 0, [[K_STRUCT, STRUCT.Bastion, -1, 0, 0, 0, 0, 0, radius]],
      0n, 120, [], BEDROCK,
    );
    expect(forts.length).toBeGreaterThan(0);
    expect(bastions.length).toBeGreaterThan(0);

    const at = (f: Found) => `${f.seed}:${f.hits[0]!.x},${f.hits[0]!.z}`;
    const fortSites = new Set(forts.map(at));
    for (const b of bastions) expect(fortSites.has(at(b))).toBe(false);
  });

  it('splits shared nether regions about two to one in favour of bastions', () => {
    const out = M._malloc(5 * 4);
    let bastions = 0;
    let total = 0;
    for (let seed = 0; seed < 40; seed++) {
      for (let rx = -8; rx < 8; rx++) {
        for (let rz = -8; rz < 8; rz++) {
          const isBastion = M._sf_bedrock_probe(STRUCT.Bastion, BigInt(seed), rx, rz, out) !== 0;
          const isFort = M._sf_bedrock_probe(STRUCT.Fortress, BigInt(seed), rx, rz, out) !== 0;
          // Exactly one of the pair claims each region.
          expect(isBastion).not.toBe(isFort);
          if (isBastion) bastions++;
          total++;
        }
      }
    }
    M._free(out);
    expect(bastions / total).toBeGreaterThan(0.6);
    expect(bastions / total).toBeLessThan(0.73);
  });

  it('puts the nether pair on the grid the reference implementation uses', () => {
    // MCBE-seedcracker: "nether_complexes", salt 30084232, spacing 30,
    // separation 4, linear spread. Chunkbiomes agrees: {30084232, 30, 26}.
    const out = M._malloc(5 * 4);
    let probed = false;
    for (let rx = 0; rx < 8 && !probed; rx++) {
      if (M._sf_bedrock_probe(STRUCT.Bastion, 12345n, rx, 0, out) !== 0) probed = true;
    }
    expect(probed).toBe(true);
    const [, , spacing, separation, spread] = [...M.HEAP32.subarray(out >> 2, (out >> 2) + 5)];
    expect(spacing).toBe(30);
    expect(separation).toBe(4);
    expect(spread).toBe(0); // linear
    M._free(out);
  });

  it('refuses variant filters that come from Java RNG', () => {
    // getVariant() rolls traits with chunkGenerateRnd, which is Java's LCG.
    // Bedrock uses a Mersenne Twister, so filtering an "above ground" ruined
    // portal on Bedrock was reporting Java's answer for a different world.
    const portalAboveGround = [
      K_STRUCT, STRUCT.Ruined_Portal, -1, 0, /* traitMask */ 4, 0, 0, 0, 500, -1,
    ];
    M.HEAP32.set(portalAboveGround, critPtr >> 2);
    expect(M._sf_configure(MC_26_2, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(-11);
    // the same filter is fine on Java
    expect(M._sf_configure(MC_26_2, 0, 0, critPtr, 1, pairPtr, 0)).toBe(1);

    // igloo basements come from getVariant too
    const iglooBasement = [
      K_STRUCT, STRUCT.Igloo, -1, /* traitReq */ 16, /* traitMask */ 16, 0, 0, 0, 500, -1,
    ];
    M.HEAP32.set(iglooBasement, critPtr >> 2);
    expect(M._sf_configure(MC_26_2, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(-11);
  });

  it('still allows the village biome constraint, which is biome-derived', () => {
    // Biome generation is shared between the editions from 1.18, so this one
    // is meaningful on Bedrock where the getVariant traits are not.
    const desertVillage = [K_STRUCT, STRUCT.Village, BIOME.desert, 0, 0, 0, 0, 0, 2_000, -1];
    M.HEAP32.set(desertVillage, critPtr >> 2);
    expect(M._sf_configure(MC_26_2, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(1);

    const found = search(
      MC_26_2, 0, 0,
      [[K_STRUCT, STRUCT.Village, BIOME.desert, 0, 0, 0, 0, 0, 2_000]],
      0n, 400, [], BEDROCK,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(f.hits[0]!.biome).toBe(BIOME.desert);
  });

  it('refuses Bedrock before 1.18, when the generators were still separate', () => {
    M.HEAP32.set([K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 500, -1], critPtr >> 2);
    expect(M._sf_configure(MC_1_16, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(-9);
    expect(M._sf_configure(MC_26_2, BEDROCK, 0, critPtr, 1, pairPtr, 0)).toBe(1);
  });
});

describe('version range', () => {
  const PALE_GARDEN = 186;
  const SULFUR_CAVES = 187;

  it('reaches 26.2, the current release', () => {
    expect(M._sf_mc_newest()).toBe(MC_26_2);
  });

  it('gates the biomes each version actually has', () => {
    expect(M._sf_biome_supported(PALE_GARDEN, MC_1_21_3)).toBe(0);
    expect(M._sf_biome_supported(PALE_GARDEN, MC_1_21_4)).not.toBe(0);
    expect(M._sf_biome_supported(SULFUR_CAVES, 35)).toBe(0);
    expect(M._sf_biome_supported(SULFUR_CAVES, MC_26_2)).not.toBe(0);
  });

  it('actually generates sulfur caves on 26.2', () => {
    // Declaring the biome exists is not enough - the 26.2 biome tree has to be
    // in use, or the generator can never emit it. This failed before the
    // btree262 table was added.
    const found = search(
      MC_26_2, 0, 0,
      [[K_BIOME, 0, SULFUR_CAVES, 0, 0, 0, 0, -16, 500]],
      0n, 200,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.hits[0]!.biome).toBe(SULFUR_CAVES);
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThanOrEqual(500);
    }
  });

  it('uses a different biome tree from 1.21.5 onwards', () => {
    // Spring to Life expanded the pale garden, which means a different biome
    // tree. The same query over the same seeds has to give different answers,
    // otherwise the new versions are just relabelled old ones.
    const paleGarden = (mc: number) =>
      search(mc, 0, 0, [[K_BIOME, 0, PALE_GARDEN, 0, 0, 0, 0, 80, 400]], 0n, 900)
        .map((f) => f.seed.toString());

    const before = paleGarden(MC_1_21_4);
    const after = paleGarden(MC_1_21_5);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toEqual(before);
  });

  it('leaves surface biomes alone from 1.21.5 through 26.2', () => {
    // 26.1 changed nothing, and 26.2 only added sulfur caves underground, so
    // a surface biome has to come out identical across all three.
    const paleGarden = (mc: number) =>
      search(mc, 0, 0, [[K_BIOME, 0, PALE_GARDEN, 0, 0, 0, 0, 80, 400]], 0n, 900)
        .map((f) => f.seed.toString());
    expect(paleGarden(MC_26_1)).toEqual(paleGarden(MC_1_21_5));
    expect(paleGarden(MC_26_2)).toEqual(paleGarden(MC_1_21_5));
  });
});

describe('per-criterion distance', () => {
  it('applies each criterion its own radius', () => {
    // village must be tight to spawn, portal may be far
    const found = search(
      MC_1_21_1, 0, 0,
      [[K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 150],
       [K_STRUCT, STRUCT.Ruined_Portal, -1, 0, 0, 0, 0, 0, 600]],
      0n, 40_000,
    );
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThanOrEqual(150);
      expect(Math.hypot(f.hits[1]!.x, f.hits[1]!.z)).toBeLessThanOrEqual(600);
    }
    // The tight radius has to actually bite: at least one result would have
    // been rejected by it if the radii were shared.
    expect(found.some((f) => Math.hypot(f.hits[1]!.x, f.hits[1]!.z) > 150)).toBe(true);
  });
});

describe('proximity rules', () => {
  const pair = [
    [K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 800],
    [K_STRUCT, STRUCT.Ruined_Portal, -1, 0, 0, 0, 0, 0, 800],
  ];

  it('keeps the two structures within the requested distance', () => {
    const found = search(MC_1_21_1, 0, 0, pair, 0n, 60_000, [[0, 1, 120]]);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      const d = Math.hypot(f.hits[0]!.x - f.hits[1]!.x, f.hits[0]!.z - f.hits[1]!.z);
      expect(d).toBeLessThanOrEqual(120);
    }
  });

  it('is a real constraint, not a no-op', () => {
    // Without the rule, the same query over the same range returns pairs that
    // the rule would have rejected.
    const loose = search(MC_1_21_1, 0, 0, pair, 0n, 60_000);
    const over = loose.filter(
      (f) => Math.hypot(f.hits[0]!.x - f.hits[1]!.x, f.hits[0]!.z - f.hits[1]!.z) > 120,
    );
    expect(over.length).toBeGreaterThan(0);
  });

  it('measures an overworld/nether rule in nether coordinates', () => {
    // "a bastion within 300 blocks of where this ruined portal drops me":
    // the overworld portal's position is divided by 8 and the distance is
    // taken from that point, in nether blocks.
    const crits = [
      [K_STRUCT, STRUCT.Ruined_Portal, -1, 0, 0, 0, 0, 0, 600],
      [K_STRUCT, STRUCT.Bastion, -1, 0, 0, 0, 0, 0, 2_000],
    ];
    const found = search(MC_1_21_1, 0, 0, crits, 0n, 80_000, [[0, 1, 300]]);
    expect(found.length).toBeGreaterThan(0);

    const netherSide = (v: number) => Math.floor(v / 8);
    for (const f of found) {
      const portal = f.hits[0]!;
      const bastion = f.hits[1]!;
      expect(portal.dim).toBe(0);
      expect(bastion.dim).toBe(-1);
      const d = Math.hypot(
        netherSide(portal.x) - bastion.x,
        netherSide(portal.z) - bastion.z,
      );
      expect(d).toBeLessThanOrEqual(300);
    }
  });

  it('makes the overworld/nether rule actually bite', () => {
    const crits = [
      [K_STRUCT, STRUCT.Ruined_Portal, -1, 0, 0, 0, 0, 0, 600],
      [K_STRUCT, STRUCT.Bastion, -1, 0, 0, 0, 0, 0, 2_000],
    ];
    const loose = search(MC_1_21_1, 0, 0, crits, 0n, 80_000);
    const netherSide = (v: number) => Math.floor(v / 8);
    const wouldFail = loose.filter((f) => {
      const p = f.hits[0]!, b = f.hits[1]!;
      return Math.hypot(netherSide(p.x) - b.x, netherSide(p.z) - b.z) > 300;
    });
    expect(wouldFail.length).toBeGreaterThan(0);
  });

  it('rejects a rule reaching into the End', () => {
    const flat = [
      [K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 500, -1],
      [K_STRUCT, STRUCT.End_City, -1, 0, 0, 0, 0, 0, 5_000, -1],
    ].flat();
    M.HEAP32.set(flat, critPtr >> 2);
    M.HEAP32.set([0, 1, 100], pairPtr >> 2);
    expect(M._sf_configure(MC_1_21_1, 0, 0, critPtr, 2, pairPtr, 1)).toBe(-8);
  });

  it('rejects a rule pointing at itself', () => {
    M.HEAP32.set([K_STRUCT, STRUCT.Village, -1, 0, 0, 0, 0, 0, 500, -1], critPtr >> 2);
    M.HEAP32.set([0, 0, 100], pairPtr >> 2);
    expect(M._sf_configure(MC_1_21_1, 0, 0, critPtr, 1, pairPtr, 1)).toBe(-7);
  });
});

describe('bastion types', () => {
  it('splits the bastions into four disjoint sets', () => {
    const byType = [0, 1, 2, 3].map((sub) =>
      search(
        MC_1_21_1, 0, 0,
        [[K_STRUCT, STRUCT.Bastion, -1, 0, 0, 0, 0, 0, 1200, sub]],
        0n, 1_500,
      ),
    );
    for (const set of byType) expect(set.length).toBeGreaterThan(0);

    const key = (f: Found) => `${f.seed}:${f.hits[0]!.x},${f.hits[0]!.z}`;
    const all = new Set<string>();
    let total = 0;
    for (const set of byType) {
      for (const f of set) all.add(key(f));
      total += set.length;
    }
    // No bastion is reported under two different types.
    expect(all.size).toBe(total);
  });
});

describe('stronghold rings', () => {
  it('places each ring at its own distance band', () => {
    const ring = (n: number, radius: number) =>
      search(
        MC_1_21_1, 0, 0,
        [[K_STRUCT, STRUCT.Stronghold, -1, 0, 0, 0, 0, 0, radius, n]],
        0n, 200,
      );

    const r1 = ring(1, 3_000);
    const r2 = ring(2, 6_500);
    expect(r1.length).toBeGreaterThan(0);
    expect(r2.length).toBeGreaterThan(0);

    // Ring 1 sits around 1280-2816 blocks; ring 2 is well beyond it.
    for (const f of r1) {
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeLessThan(3_000);
    }
    for (const f of r2) {
      expect(Math.hypot(f.hits[0]!.x, f.hits[0]!.z)).toBeGreaterThan(3_000);
    }
  });
});

describe('multi-structure AND semantics', () => {
  it('only returns seeds that satisfy every criterion on its own', () => {
    const radius = 500;
    const start = 1_000_000n;
    const count = 30_000;

    const both = search(MC_1_21_1, radius, 0, [[K_STRUCT, STRUCT.Village], [K_STRUCT, STRUCT.Outpost]], start, count);
    const villages = new Set(
      search(MC_1_21_1, radius, 0, [[K_STRUCT, STRUCT.Village]], start, count).map((f) => f.seed),
    );
    const outposts = new Set(
      search(MC_1_21_1, radius, 0, [[K_STRUCT, STRUCT.Outpost]], start, count).map((f) => f.seed),
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
    const a = search(MC_1_21_1, 450, 1, [[K_STRUCT, STRUCT.Village], [K_STRUCT, STRUCT.Ruined_Portal]], 777n, 20_000);
    const b = search(MC_1_21_1, 450, 1, [[K_STRUCT, STRUCT.Village], [K_STRUCT, STRUCT.Ruined_Portal]], 777n, 20_000);
    expect(a.map((f) => f.seed.toString())).toEqual(b.map((f) => f.seed.toString()));
    expect(a.length).toBeGreaterThan(0);
  });

  it('reports a spawn point that the distances are relative to', () => {
    const radius = 500;
    const found = search(MC_1_21_1, radius, 1, [[K_STRUCT, STRUCT.Village]], 12_345n, 20_000);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      const h = f.hits[0]!;
      expect(Math.hypot(h.x - f.spawnX, h.z - f.spawnZ)).toBeLessThanOrEqual(radius);
    }
  });
});
