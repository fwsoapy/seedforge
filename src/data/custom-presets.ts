/**
 * Presets the user saves themselves.
 *
 * Kept in this browser's localStorage and nowhere else: nothing is uploaded,
 * there is no account, and clearing site data clears them. That is the whole
 * storage model, and it is why this file is careful about what it reads back.
 *
 * Anything in localStorage is untrusted input. It can be hand-edited, left
 * behind by an older version of the app, or corrupted. So a stored preset is
 * validated field by field on the way in, and anything that does not survive
 * is dropped rather than handed to the picker.
 *
 * The built-in presets are not part of this at all. They are compiled into the
 * bundle, this file only ever reads and writes the user's own list, and a
 * stored entry claiming a built-in key is rejected rather than allowed to
 * shadow one. So they cannot be edited or deleted, whatever is in storage.
 */

import { KIND, type CriterionKind } from '../search/types';
import { PRESETS, type Preset, type PresetCriterion, type PresetRule } from './presets';

const KEY = 'seedforge:presets';

/** How many a user may keep. */
export const MAX_CUSTOM_PRESETS = 8;

/** Longest name accepted, so a button stays a button. */
export const MAX_PRESET_NAME = 32;

export interface CustomPreset extends Preset {
  /** Marks it as the user's, which the built-in list never is. */
  readonly custom: true;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isKind = (v: unknown): v is CriterionKind => v === KIND.structure || v === KIND.biome;

const isRadius = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30_000_000;

function readVariants(v: unknown): Record<string, string> | undefined {
  if (!isObject(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    // Only strings; a null here means "Any", which is the same as absent.
    if (typeof k === 'string' && typeof value === 'string') out[k] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readCriterion(v: unknown): PresetCriterion | null {
  if (!isObject(v)) return null;
  if (!isKind(v['kind'])) return null;
  if (typeof v['id'] !== 'number' || !Number.isInteger(v['id'])) return null;
  if (!isRadius(v['radius'])) return null;
  const variants = readVariants(v['variants']);
  return {
    kind: v['kind'],
    id: v['id'],
    radius: v['radius'],
    ...(variants ? { variants } : {}),
  };
}

function readEnd(v: unknown): readonly [CriterionKind, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  if (!isKind(v[0]) || typeof v[1] !== 'number' || !Number.isInteger(v[1])) return null;
  return [v[0], v[1]];
}

function readRule(v: unknown): PresetRule | null {
  if (!isObject(v)) return null;
  const a = readEnd(v['a']);
  const b = readEnd(v['b']);
  if (!a || !b) return null;
  if (!isRadius(v['maxDist'])) return null;
  return { a, b, maxDist: v['maxDist'] };
}

const BUILT_IN_KEYS: ReadonlySet<string> = new Set(PRESETS.map((p) => p.key));

function readPreset(v: unknown): CustomPreset | null {
  if (!isObject(v)) return null;
  if (typeof v['key'] !== 'string' || v['key'] === '') return null;
  // A saved preset may not claim a built-in's identity.
  if (BUILT_IN_KEYS.has(v['key'])) return null;
  if (typeof v['name'] !== 'string') return null;
  const name = v['name'].trim().slice(0, MAX_PRESET_NAME);
  if (name === '') return null;

  const criteria = Array.isArray(v['criteria'])
    ? v['criteria'].map(readCriterion).filter((c): c is PresetCriterion => c !== null)
    : [];
  if (criteria.length === 0) return null;

  const rules = Array.isArray(v['rules'])
    ? v['rules'].map(readRule).filter((r): r is PresetRule => r !== null)
    : [];

  return {
    key: v['key'],
    name,
    blurb: typeof v['blurb'] === 'string' ? v['blurb'].slice(0, 120) : summarise(criteria, rules),
    criteria,
    rules,
    custom: true,
  };
}

/** "3 structures, 1 biome, 2 rules", for the line under the button. */
export function summarise(
  criteria: readonly PresetCriterion[],
  rules: readonly PresetRule[],
): string {
  const structures = criteria.filter((c) => c.kind === KIND.structure).length;
  const biomes = criteria.length - structures;
  const parts: string[] = [];
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (structures > 0) parts.push(plural(structures, 'structure'));
  if (biomes > 0) parts.push(plural(biomes, 'biome'));
  if (rules.length > 0) parts.push(plural(rules.length, 'rule'));
  return parts.join(', ');
}

/**
 * Everything saved here, worst case an empty list.
 *
 * Storage can throw outright in a locked-down browser, so every access is
 * guarded and a failure simply means there are no saved presets.
 */
export function loadCustomPresets(): CustomPreset[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: CustomPreset[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const preset = readPreset(item);
    if (!preset || seen.has(preset.key)) continue;
    seen.add(preset.key);
    out.push(preset);
    if (out.length >= MAX_CUSTOM_PRESETS) break;
  }
  return out;
}

/**
 * Returns false when storage refuses the write, so the caller can say so.
 *
 * Only the user's own presets are ever written. Anything carrying a built-in
 * key is dropped here too, so no path through the app can persist one.
 */
export function saveCustomPresets(presets: readonly CustomPreset[]): boolean {
  const own = presets.filter((p) => !BUILT_IN_KEYS.has(p.key)).slice(0, MAX_CUSTOM_PRESETS);
  try {
    localStorage.setItem(KEY, JSON.stringify(own));
    return true;
  } catch {
    // Private mode, blocked site data, or the quota is full.
    return false;
  }
}

/** Unique enough for a list of at most eight, and stable once written. */
export function newPresetKey(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
