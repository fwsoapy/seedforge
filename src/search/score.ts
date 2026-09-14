/** Ranking for the results list. */

import type { Match, MatchHit } from './types';

/** The point a hit's distance is measured from, in that hit's own dimension. */
export function targetOf(hit: MatchHit, m: Match): { x: number; z: number } {
  // Nether structures are filtered against the Nether-side target point.
  return hit.dim === -1
    ? { x: Math.floor(m.spawnX / 8), z: Math.floor(m.spawnZ / 8) }
    : { x: m.spawnX, z: m.spawnZ };
}

/**
 * How close a whole match is.
 *
 * The first number is the furthest hit - the "everything is within X blocks"
 * figure, which is what people actually care about. The second is the total,
 * used only to break ties, so a genuinely tight cluster ranks above one that
 * merely shares the same worst case.
 */
export function matchScore(m: Match): [worst: number, total: number] {
  let worst = 0;
  let total = 0;
  for (const hit of m.hits) {
    const t = targetOf(hit, m);
    const d = Math.hypot(hit.x - t.x, hit.z - t.z);
    if (d > worst) worst = d;
    total += d;
  }
  return [worst, total];
}

/** Sorts in place, closest match first. */
export function sortByCloseness(matches: Match[]): Match[] {
  return matches.sort((a, b) => {
    const [aw, at] = matchScore(a);
    const [bw, bt] = matchScore(b);
    return aw - bw || at - bt;
  });
}
