/**
 * Ready-made searches.
 *
 * A preset is written once, for Java, with every filter it would ideally use.
 * Applying it on Bedrock does not need a second copy: anything the Bedrock
 * generator does not place is dropped, and so is any variant filter derived
 * from Java's RNG, by the same rules that govern the picker itself. A
 * stronghold criterion therefore disappears on Bedrock, and a bastion keeps
 * its position but loses its type.
 *
 * Radii are deliberately tight. A preset is meant to be clicked and searched,
 * so the point is a result in seconds rather than the widest possible net.
 */

import { BIOME } from './biomes';
import { STRUCT } from './structures';
import { KIND, type CriterionKind } from '../search/types';

export interface PresetCriterion {
  readonly kind: CriterionKind;
  readonly id: number;
  readonly radius: number;
  /** Variant group key -> option value, as used by the picker. */
  readonly variants?: Readonly<Record<string, string>>;
}

/** A proximity rule, pointing at criteria by id rather than by position. */
export interface PresetRule {
  readonly a: readonly [CriterionKind, number];
  readonly b: readonly [CriterionKind, number];
  readonly maxDist: number;
}

export interface Preset {
  readonly key: string;
  readonly name: string;
  /** One line under the button saying what you get. */
  readonly blurb: string;
  readonly criteria: readonly PresetCriterion[];
  readonly rules: readonly PresetRule[];
  /**
   * Presets sharing a group render as one tile, headed by this text with a
   * row of options inside it. Used where several presets are variations on
   * the same idea and should not each take a tile of their own.
   */
  readonly group?: string;
  /** Short label for the button inside a group, where `name` is too long. */
  readonly option?: string;
}

const s = (id: number, radius: number, variants?: Record<string, string>): PresetCriterion => ({
  kind: KIND.structure,
  id,
  radius,
  ...(variants ? { variants } : {}),
});

const b = (id: number, radius: number): PresetCriterion => ({ kind: KIND.biome, id, radius });

const near = (
  a: readonly [CriterionKind, number],
  bb: readonly [CriterionKind, number],
  maxDist: number,
): PresetRule => ({ a, b: bb, maxDist });

const S = KIND.structure;
const B = KIND.biome;

/** Heading for the three-way advanced speedrun tile. */
const ADVANCED = 'Advanced Speedrun';
const ADVANCED_BLURB =
  'Pick a start, then template 8 portal, bastion, fortress and ring 1. '
  + 'Very restrictive, so expect a long search.';

export const PRESETS: readonly Preset[] = [
  {
    key: 'simple-speedrun',
    name: 'Simple Speedrun',
    blurb: 'Village at spawn with an above-ground portal right next to it.',
    criteria: [
      s(STRUCT.Village, 100, { abandoned: 'no' }),
      s(STRUCT.Ruined_Portal, 200, { portalPlacement: 'surface' }),
    ],
    rules: [near([S, STRUCT.Ruined_Portal], [S, STRUCT.Village], 200)],
  },
  /*
   * Three ways to open the same run, sharing one tile. Each is the same chain
   * after the start: an above-ground template 8 portal, a bastion of a given
   * type, a fortress off it, and a ring 1 stronghold.
   */
  {
    key: 'advanced-speedrun-village',
    group: ADVANCED,
    option: 'Village',
    name: 'Advanced Speedrun: Village',
    blurb: ADVANCED_BLURB,
    criteria: [
      s(STRUCT.Village, 100, { biome: 'plains', abandoned: 'no' }),
      s(STRUCT.Ruined_Portal, 200, {
        portalType: 'normal',
        portalPlacement: 'surface',
        portalTemplate: '8',
      }),
      s(STRUCT.Bastion, 300, { bastionType: 'treasure' }),
      s(STRUCT.Fortress, 300),
      s(STRUCT.Stronghold, 1500, { ring: '1' }),
    ],
    rules: [
      near([S, STRUCT.Ruined_Portal], [S, STRUCT.Village], 100),
      near([S, STRUCT.Bastion], [S, STRUCT.Ruined_Portal], 100),
      near([S, STRUCT.Fortress], [S, STRUCT.Bastion], 200),
    ],
  },
  {
    key: 'advanced-speedrun-treasure',
    group: ADVANCED,
    option: 'Treasure',
    name: 'Advanced Speedrun: Treasure',
    blurb: ADVANCED_BLURB,
    criteria: [
      s(STRUCT.Ruined_Portal, 100, {
        portalType: 'normal',
        portalPlacement: 'surface',
        portalTemplate: '8',
      }),
      s(STRUCT.Treasure, 25),
      s(STRUCT.Bastion, 300, { bastionType: 'bridge' }),
      s(STRUCT.Fortress, 300),
      s(STRUCT.Stronghold, 1500, { ring: '1' }),
    ],
    rules: [
      near([S, STRUCT.Bastion], [S, STRUCT.Ruined_Portal], 100),
      near([S, STRUCT.Fortress], [S, STRUCT.Bastion], 200),
      near([S, STRUCT.Ruined_Portal], [S, STRUCT.Treasure], 50),
    ],
  },
  {
    key: 'advanced-speedrun-shipwreck',
    group: ADVANCED,
    option: 'Shipwreck',
    name: 'Advanced Speedrun: Shipwreck',
    blurb: ADVANCED_BLURB,
    criteria: [
      s(STRUCT.Ruined_Portal, 100, {
        portalType: 'normal',
        portalPlacement: 'surface',
        portalTemplate: '8',
      }),
      s(STRUCT.Shipwreck, 200),
      s(STRUCT.Bastion, 500, { bastionType: 'treasure' }),
      s(STRUCT.Fortress, 500),
      s(STRUCT.Stronghold, 1500, { ring: '1' }),
    ],
    rules: [
      near([S, STRUCT.Bastion], [S, STRUCT.Ruined_Portal], 100),
      near([S, STRUCT.Fortress], [S, STRUCT.Bastion], 200),
      near([S, STRUCT.Ruined_Portal], [S, STRUCT.Shipwreck], 200),
    ],
  },
  {
    key: 'perfect-start',
    name: 'Perfect Start',
    blurb: 'A village in good country, with a portal and an outpost close by.',
    criteria: [
      s(STRUCT.Village, 150, { biome: 'plains' }),
      s(STRUCT.Ruined_Portal, 250),
      s(STRUCT.Outpost, 400),
      b(BIOME.forest, 300),
      b(BIOME.meadow, 350),
    ],
    rules: [near([S, STRUCT.Ruined_Portal], [S, STRUCT.Village], 250)],
  },
  {
    key: 'rare-finds',
    name: 'Rare Finds',
    blurb: 'Ancient city, mansion and ice spikes, all near spawn.',
    criteria: [
      s(STRUCT.Ancient_City, 600),
      s(STRUCT.Mansion, 1200),
      s(STRUCT.Village, 400),
      b(BIOME.ice_spikes, 800),
    ],
    rules: [near([S, STRUCT.Village], [S, STRUCT.Mansion], 800)],
  },
];

/** Marks a preset's biome criteria, which the picker keys separately. */
export const PRESET_BIOME_KIND = B;
