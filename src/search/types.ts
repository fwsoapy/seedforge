/** Shared types for the search engine and the worker protocol. */

/** Target point that distances are measured from. */
export const TARGET = {
  origin: 0,
  estimatedSpawn: 1,
  exactSpawn: 2,
} as const;

export type TargetMode = (typeof TARGET)[keyof typeof TARGET];

/** Which edition's world generator to search. */
export const EDITION = { java: 0, bedrock: 1 } as const;
export type Edition = (typeof EDITION)[keyof typeof EDITION];

export const KIND = { structure: 0, biome: 1 } as const;
export type CriterionKind = (typeof KIND)[keyof typeof KIND];

/** One requirement. All criteria must be satisfied (AND). */
export interface Criterion {
  kind: CriterionKind;
  /** Structure id for `kind: structure`, biome id for `kind: biome`. */
  id: number;
  /** Variant group key -> selected option value (`null` = Any). */
  variants: Record<string, string | null>;
  /** This criterion's own maximum distance from the target point, in blocks. */
  radius: number;
}

/**
 * "These two criteria must generate within `maxDist` blocks of each other."
 * Indices refer to positions in the criteria array.
 */
export interface ProximityRule {
  a: number;
  b: number;
  maxDist: number;
}

export interface SearchConfig {
  mc: number;
  edition: Edition;
  target: TargetMode;
  criteria: Criterion[];
  /** Extra AND conditions between pairs of criteria. */
  rules: ProximityRule[];
  /** First seed to test. Only the low 48 bits affect structure placement. */
  startSeed: bigint;
  /** Stop after this many seeds; 0 means "keep going until stopped". */
  seedLimit: bigint;
  /** Stop after this many matches; 0 means unlimited. */
  matchLimit: number;
}

export interface MatchHit {
  kind: CriterionKind;
  id: number;
  x: number;
  z: number;
  /** Village biome id, or -1 when the structure has no biome variant. */
  biome: number;
  dim: number;
}

export interface Match {
  seed: bigint;
  spawnX: number;
  spawnZ: number;
  hits: MatchHit[];
}

export type WorkerIn =
  | { type: 'start'; config: SerializableConfig; lane: number; lanes: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'progress'; scanned: number; stage2: number }
  | { type: 'matches'; matches: SerializableMatch[]; scanned: number; stage2: number }
  | { type: 'done'; scanned: number }
  | { type: 'error'; message: string };

/** `SearchConfig` with bigints kept as bigints (structured clone handles them). */
export type SerializableConfig = SearchConfig;

export interface SerializableMatch {
  seed: bigint;
  spawnX: number;
  spawnZ: number;
  hits: MatchHit[];
}
