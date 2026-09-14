import { describe, expect, it } from 'vitest';

import { matchScore, sortByCloseness, targetOf } from '../src/search/score';
import { KIND, type Match, type MatchHit } from '../src/search/types';

const hit = (x: number, z: number, dim = 0): MatchHit => ({
  kind: KIND.structure,
  id: 5,
  x,
  z,
  biome: -1,
  dim,
});

const match = (seed: number, hits: MatchHit[], spawnX = 0, spawnZ = 0): Match => ({
  seed: BigInt(seed),
  spawnX,
  spawnZ,
  hits,
});

describe('matchScore', () => {
  it('scores on the furthest hit', () => {
    expect(matchScore(match(1, [hit(100, 0), hit(300, 0)]))[0]).toBe(300);
  });

  it('totals the hits as a tiebreak', () => {
    const [, total] = matchScore(match(1, [hit(100, 0), hit(300, 0)]));
    expect(total).toBe(400);
  });

  it('measures from the spawn point, not the origin', () => {
    // structure sits on top of spawn, so the distance is zero even though it
    // is 500 blocks from 0,0
    expect(matchScore(match(1, [hit(500, 0)], 500, 0))[0]).toBe(0);
  });

  it('measures nether hits against the nether-side spawn', () => {
    // spawn 800,0 -> nether side 100,0; a structure at nether 100,0 is on it
    expect(targetOf(hit(0, 0, -1), match(1, [], 800, 0))).toEqual({ x: 100, z: 0 });
    expect(matchScore(match(1, [hit(100, 0, -1)], 800, 0))[0]).toBe(0);
  });
});

describe('sortByCloseness', () => {
  it('puts the tighter match first regardless of find order', () => {
    const far = match(1, [hit(500, 0), hit(480, 0)]);
    const near = match(2, [hit(200, 0), hit(150, 0)]);
    const sorted = sortByCloseness([far, near]);
    expect(sorted.map((m) => Number(m.seed))).toEqual([2, 1]);
  });

  it('breaks ties on the total distance', () => {
    // same worst case, but one is a tighter cluster overall
    const loose = match(1, [hit(300, 0), hit(290, 0)]);
    const tight = match(2, [hit(300, 0), hit(10, 0)]);
    expect(sortByCloseness([loose, tight]).map((m) => Number(m.seed))).toEqual([2, 1]);
  });

  it('is stable enough to leave an already-sorted list alone', () => {
    const a = match(1, [hit(100, 0)]);
    const b = match(2, [hit(200, 0)]);
    const c = match(3, [hit(300, 0)]);
    expect(sortByCloseness([a, b, c]).map((m) => Number(m.seed))).toEqual([1, 2, 3]);
  });
});
