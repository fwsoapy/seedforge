/**
 * Seeds the user keeps, and the links they hand out.
 *
 * Two different things with one shape.
 *
 * A saved seed lives in this browser's localStorage, like the saved presets.
 * Nothing is uploaded, there is no account, and clearing site data clears it.
 *
 * A shared seed lives in the link itself. There is no server behind this site,
 * so a link carries its own payload in the fragment rather than pointing at a
 * record somewhere. Two things follow from that, and both are stated in the
 * UI rather than buried here:
 *
 *   - The fragment is never sent to the host, so a shared seed does not reach
 *     GitHub Pages' logs. That part is a genuine benefit.
 *   - The expiry is a timestamp inside the link that the receiving page
 *     checks. It stops a link working a week later for anyone opening it
 *     normally, which is what it is for. It is not enforcement: whoever holds
 *     the link holds the data, and an expiry they can edit is one they can
 *     remove. Anything genuinely private should not be shared this way.
 *
 * Everything read back, from storage or from a link, is untrusted and gets
 * validated field by field.
 */

import { KIND, type CriterionKind, type Edition, type TargetMode } from '../search/types';
import type { PresetCriterion, PresetRule } from './presets';

const KEY = 'seedforge:seeds';

/** How many seeds a user may keep. */
export const MAX_SAVED_SEEDS = 5;

/** Longest note accepted against a saved seed. */
export const MAX_SEED_NOTE = 40;

/** How long a shared link stays good for. */
export const SHARE_DAYS = 7;
const SHARE_MS = SHARE_DAYS * 24 * 60 * 60 * 1000;

/** Everything needed to reproduce what the seed was found by. */
export interface SeedRecord {
  /** Decimal string, because a 64-bit seed does not survive JSON as a number. */
  readonly seed: string;
  readonly mc: number;
  readonly edition: Edition;
  readonly target: TargetMode;
  readonly criteria: readonly PresetCriterion[];
  readonly rules: readonly PresetRule[];
  readonly note?: string;
}

export interface SavedSeed extends SeedRecord {
  readonly key: string;
  readonly savedAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isKind = (v: unknown): v is CriterionKind => v === KIND.structure || v === KIND.biome;

const isRadius = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30_000_000;

const isIndex = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 4096;

/** A seed is stored as text; it has to parse and fit in 64 bits. */
function readSeed(v: unknown): string | null {
  if (typeof v !== 'string' || v === '' || v.length > 24) return null;
  if (!/^-?\d+$/.test(v)) return null;
  try {
    const n = BigInt(v);
    if (n < -(2n ** 63n) || n > 2n ** 64n - 1n) return null;
    return n.toString();
  } catch {
    return null;
  }
}

function readVariants(v: unknown): Record<string, string> | undefined {
  if (!isObject(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v)) {
    if (typeof value === 'string') out[k] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readCriterion(v: unknown): PresetCriterion | null {
  if (!isObject(v)) return null;
  if (!isKind(v['kind']) || !isIndex(v['id']) || !isRadius(v['radius'])) return null;
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
  if (!isKind(v[0]) || !isIndex(v[1])) return null;
  return [v[0], v[1]];
}

function readRule(v: unknown): PresetRule | null {
  if (!isObject(v)) return null;
  const a = readEnd(v['a']);
  const b = readEnd(v['b']);
  if (!a || !b || !isRadius(v['maxDist'])) return null;
  return { a, b, maxDist: v['maxDist'] };
}

/** The part shared by a stored seed and a shared one. */
export function readRecord(v: unknown): SeedRecord | null {
  if (!isObject(v)) return null;
  const seed = readSeed(v['seed']);
  if (seed === null) return null;
  if (!isIndex(v['mc'])) return null;
  if (v['edition'] !== 0 && v['edition'] !== 1) return null;
  if (v['target'] !== 0 && v['target'] !== 1 && v['target'] !== 2) return null;

  const criteria = Array.isArray(v['criteria'])
    ? v['criteria'].map(readCriterion).filter((c): c is PresetCriterion => c !== null)
    : [];
  if (criteria.length === 0) return null;

  const rules = Array.isArray(v['rules'])
    ? v['rules'].map(readRule).filter((r): r is PresetRule => r !== null)
    : [];

  const note = typeof v['note'] === 'string' ? v['note'].trim().slice(0, MAX_SEED_NOTE) : '';

  return {
    seed,
    mc: v['mc'],
    edition: v['edition'] as Edition,
    target: v['target'] as TargetMode,
    criteria,
    rules,
    ...(note !== '' ? { note } : {}),
  };
}

function readSaved(v: unknown): SavedSeed | null {
  const record = readRecord(v);
  if (!record || !isObject(v)) return null;
  if (typeof v['key'] !== 'string' || v['key'] === '') return null;
  const savedAt = typeof v['savedAt'] === 'number' && Number.isFinite(v['savedAt'])
    ? v['savedAt']
    : 0;
  return { ...record, key: v['key'], savedAt };
}

export function loadSavedSeeds(): SavedSeed[] {
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

  const out: SavedSeed[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const saved = readSaved(item);
    if (!saved || seen.has(saved.key)) continue;
    seen.add(saved.key);
    out.push(saved);
    if (out.length >= MAX_SAVED_SEEDS) break;
  }
  return out;
}

/** Returns false when storage refuses the write, so the caller can say so. */
export function saveSavedSeeds(seeds: readonly SavedSeed[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(seeds.slice(0, MAX_SAVED_SEEDS)));
    return true;
  } catch {
    return false;
  }
}

export function newSeedKey(): string {
  return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* --- share links ------------------------------------------------------- */

/** Bumped if the payload shape ever changes, so old links fail cleanly. */
const SHARE_VERSION = 1;

/** base64url, so the payload survives a URL fragment without escaping. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** The payload half of a share link, without the page URL in front of it. */
export function encodeShare(record: SeedRecord, now = Date.now()): string {
  const payload = {
    v: SHARE_VERSION,
    exp: Math.floor((now + SHARE_MS) / 1000),
    seed: record.seed,
    mc: record.mc,
    edition: record.edition,
    target: record.target,
    criteria: record.criteria,
    rules: record.rules,
    ...(record.note !== undefined ? { note: record.note } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

export type ShareResult =
  | { readonly ok: true; readonly record: SeedRecord; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: 'expired' | 'unreadable' };

export function decodeShare(payload: string, now = Date.now()): ShareResult {
  const text = fromBase64Url(payload);
  if (text === null) return { ok: false, reason: 'unreadable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!isObject(parsed) || parsed['v'] !== SHARE_VERSION) {
    return { ok: false, reason: 'unreadable' };
  }
  if (typeof parsed['exp'] !== 'number' || !Number.isFinite(parsed['exp'])) {
    return { ok: false, reason: 'unreadable' };
  }

  const record = readRecord(parsed);
  if (!record) return { ok: false, reason: 'unreadable' };

  const expiresAt = parsed['exp'] * 1000;
  if (now >= expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, record, expiresAt };
}

/** How many whole days are left, for the note under a fresh link. */
export function daysLeft(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)));
}
