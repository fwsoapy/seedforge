import { describe, expect, it } from 'vitest';

import { mapExtent } from '../src/ui/results';
import { KIND, type Match, type MatchHit } from '../src/search/types';

const hit = (x: number, z: number, dim = 0): MatchHit => ({
  kind: KIND.structure, id: 5, x, z, biome: -1, dim,
});
const match = (hits: MatchHit[], spawnX = 0, spawnZ = 0): Match => ({
  seed: 1n, spawnX, spawnZ, hits,
});

describe('mapExtent', () => {
  it('follows the structures, not the search radius', () => {
    // Four structures inside ~113 blocks, which is what prompted this: the map
    // used to be drawn at the 1000 block search radius with everything huddled
    // in the middle.
    const m = match([hit(64, 48), hit(16, 112), hit(-80, 0), hit(-80, 0)]);
    expect(mapExtent(m)).toBe(300);
  });

  it('gives the furthest hit 100 blocks of room, rounded up to a hundred', () => {
    expect(mapExtent(match([hit(400, 0)]))).toBe(500);
    expect(mapExtent(match([hit(300, 0)]))).toBe(400);
    expect(mapExtent(match([hit(410, 0)]))).toBe(600);
  });

  it('never collapses below 100 blocks', () => {
    expect(mapExtent(match([hit(0, 0)]))).toBe(100);
    expect(mapExtent(match([]))).toBe(100);
  });

  it('measures from spawn rather than the origin', () => {
    // structure sits on spawn, so the map stays at its floor even though the
    // structure is 500 blocks from 0,0
    expect(mapExtent(match([hit(500, 0)], 500, 0))).toBe(100);
  });

  it('uses nether coordinates for nether hits', () => {
    // spawn 800,0 maps to nether 100,0; a bastion at nether 300,0 is 200 away
    expect(mapExtent(match([hit(300, 0, -1)], 800, 0))).toBe(300);
  });
});
