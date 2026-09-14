/**
 * Structure catalogue.
 *
 * The numeric ids mirror cubiomes' `StructureType` enum. Which structures
 * actually exist in a given Minecraft version is NOT hardcoded here - the
 * UI asks the WASM core via `sf_supported()`, so cubiomes stays the single
 * source of truth for version gating.
 */

import { BIOME } from './biomes';

export const STRUCT = {
  Desert_Pyramid: 1,
  Jungle_Temple: 2,
  Swamp_Hut: 3,
  Igloo: 4,
  Village: 5,
  Ocean_Ruin: 6,
  Shipwreck: 7,
  Monument: 8,
  Mansion: 9,
  Outpost: 10,
  Ruined_Portal: 11,
  Ruined_Portal_N: 12,
  Ancient_City: 13,
  Treasure: 14,
  Mineshaft: 15,
  Desert_Well: 16,
  Geode: 17,
  Fortress: 18,
  Bastion: 19,
  End_City: 20,
  End_Gateway: 21,
  Trail_Ruins: 23,
  Trial_Chambers: 24,
  /** Not a cubiomes StructureType - handled separately by the WASM core. */
  Stronghold: 25,
  /**
   * Bedrock only. Fortresses and bastions share one region grid and only one
   * of the two stands in each occupied region, so on Bedrock they are searched
   * as a single "nether complex".
   */
  Nether_Complex: 26,
} as const;

/** Variant trait bits, matching SF_TRAIT_* in wasm/bindings.c. */
export const TRAIT = {
  abandoned: 1 << 0,
  giant: 1 << 1,
  underground: 1 << 2,
  airpocket: 1 << 3,
  basement: 1 << 4,
  cracked: 1 << 5,
} as const;

export type Dimension = 'overworld' | 'nether' | 'end';

export interface VariantOption {
  /** Value stored in the criterion; `null` means "Any". */
  readonly value: string | null;
  readonly label: string;
  /** Biome id constraint passed to isViableStructurePos(). */
  readonly biome?: number;
  /** Required trait bits. */
  readonly traitReq?: number;
  /** Trait bits this option constrains. */
  readonly traitMask?: number;
  /** Starting-piece footprint bounds in blocks squared (0 = unbounded). */
  readonly areaMin?: number;
  readonly areaMax?: number;
  /**
   * Starting-piece index from getVariant(). Bastion type, ruined portal
   * template, or stronghold ring depending on the structure.
   */
  readonly subtype?: number;
}

export interface VariantGroup {
  readonly key: string;
  readonly label: string;
  /** Shown with an "experimental" warning in the UI. */
  readonly experimental?: boolean;
  /**
   * True when the filter is derived from cubiomes' getVariant(), which uses
   * Java's RNG. Bedrock rolls these with a different generator entirely, so
   * the answer would be Java's for a Bedrock world. Hidden on Bedrock.
   */
  readonly javaOnly?: boolean;
  /** Extra explanation rendered under the dropdown. */
  readonly note?: string;
  readonly options: readonly VariantOption[];
}

export interface StructureDef {
  readonly id: number;
  readonly name: string;
  readonly dim: Dimension;
  /** Short note surfaced in the picker (caveats, minimum distances, ...). */
  readonly note?: string;
  readonly variants?: readonly VariantGroup[];
  /**
   * Only offered on Bedrock. The other direction needs no flag: a structure
   * Bedrock does not place is hidden by sf_bedrock_supported().
   */
  readonly bedrockOnly?: boolean;
}

const ANY: VariantOption = { value: null, label: 'Any' };

/**
 * Ruined portal filters, kept as three independent groups so type, placement
 * and template can each be set or left open on their own.
 *
 * Giant portals are their own set of three templates in the game, so picking
 * "Giant" narrows the template list to 1-3; the template selector is numbered
 * the way the game's own structure files are.
 */
const RUINED_PORTAL_TYPE: VariantGroup = {
  key: 'portalType',
  javaOnly: true,
  label: 'Portal type',
  options: [
    ANY,
    { value: 'giant', label: 'Giant', traitReq: TRAIT.giant, traitMask: TRAIT.giant },
    { value: 'normal', label: 'Normal', traitReq: 0, traitMask: TRAIT.giant },
  ],
};

const RUINED_PORTAL_PLACEMENT: VariantGroup = {
  key: 'portalPlacement',
  javaOnly: true,
  label: 'Placement',
  options: [
    ANY,
    { value: 'surface', label: 'Above ground', traitReq: 0, traitMask: TRAIT.underground },
    { value: 'buried', label: 'Underground', traitReq: TRAIT.underground, traitMask: TRAIT.underground },
  ],
};

const RUINED_PORTAL_TEMPLATE: VariantGroup = {
  key: 'portalTemplate',
  javaOnly: true,
  label: 'Template',
  note: 'Which of the game\'s portal_N structure files was used. Giant portals only use templates 1-3.',
  options: [
    ANY,
    ...Array.from({ length: 10 }, (_, i) => ({
      value: String(i + 1),
      label: `Template ${i + 1}`,
      subtype: i + 1,
    })),
  ],
};

/**
 * The four bastion remnant types. cubiomes exposes the chosen starting piece
 * as getVariant().start, which maps directly onto them.
 */
const BASTION_TYPE: VariantGroup = {
  key: 'bastionType',
  javaOnly: true,
  label: 'Bastion type',
  options: [
    ANY,
    { value: 'housing', label: 'Housing units', subtype: 0 },
    { value: 'stables', label: 'Hoglin stables', subtype: 1 },
    { value: 'treasure', label: 'Treasure room', subtype: 2 },
    { value: 'bridge', label: 'Bridge', subtype: 3 },
  ],
};

/**
 * Strongholds generate in concentric rings. cubiomes can tell us which ring a
 * stronghold belongs to and where it is, but not what is inside it - the
 * piece layout (portal room orientation, libraries) is not modelled, so those
 * are deliberately not offered as filters.
 */
const STRONGHOLD_RING: VariantGroup = {
  key: 'ring',
  label: 'Ring',
  note: 'Ring 1 sits roughly 1280-2816 blocks out, and each ring after that is further again.',
  options: [
    ANY,
    ...Array.from({ length: 8 }, (_, i) => ({
      value: String(i + 1),
      label: `Ring ${i + 1}`,
      subtype: i + 1,
    })),
  ],
};

export const STRUCTURES: readonly StructureDef[] = [
  {
    id: STRUCT.Village,
    name: 'Village',
    dim: 'overworld',
    variants: [
      {
        key: 'biome',
        label: 'Village type',
        options: [
          ANY,
          { value: 'plains', label: 'Plains', biome: BIOME.plains },
          { value: 'desert', label: 'Desert', biome: BIOME.desert },
          { value: 'savanna', label: 'Savanna', biome: BIOME.savanna },
          { value: 'taiga', label: 'Taiga', biome: BIOME.taiga },
          { value: 'snowy', label: 'Snowy', biome: BIOME.snowy_tundra },
        ],
      },
      {
        key: 'size',
  javaOnly: true,
        label: 'Size',
        experimental: true,
        note: 'Inferred from the starting meeting-point piece. The jigsaw expansion that decides the real village size is not modelled, so treat this as a hint.',
        options: [
          ANY,
          { value: 'small', label: 'Small start', areaMax: 100 },
          { value: 'medium', label: 'Medium start', areaMin: 101, areaMax: 200 },
          { value: 'large', label: 'Large start', areaMin: 201 },
        ],
      },
      {
        key: 'abandoned',
  javaOnly: true,
        label: 'Zombie village',
        options: [
          ANY,
          { value: 'yes', label: 'Zombie village only', traitReq: TRAIT.abandoned, traitMask: TRAIT.abandoned },
          { value: 'no', label: 'Normal village only', traitReq: 0, traitMask: TRAIT.abandoned },
        ],
      },
    ],
  },
  {
    id: STRUCT.Ruined_Portal,
    name: 'Ruined portal',
    dim: 'overworld',
    variants: [RUINED_PORTAL_TYPE, RUINED_PORTAL_PLACEMENT, RUINED_PORTAL_TEMPLATE],
  },
  { id: STRUCT.Outpost, name: 'Pillager outpost', dim: 'overworld' },
  { id: STRUCT.Desert_Pyramid, name: 'Desert pyramid', dim: 'overworld', note: '1.18+ terrain height check is approximate' },
  { id: STRUCT.Jungle_Temple, name: 'Jungle temple', dim: 'overworld', note: '1.18+ terrain height check is approximate' },
  { id: STRUCT.Swamp_Hut, name: 'Witch hut', dim: 'overworld' },
  {
    id: STRUCT.Igloo,
    name: 'Igloo',
    dim: 'overworld',
    variants: [
      {
        key: 'basement',
  javaOnly: true,
        label: 'Basement',
        experimental: true,
        options: [
          ANY,
          { value: 'yes', label: 'With basement', traitReq: TRAIT.basement, traitMask: TRAIT.basement },
          { value: 'no', label: 'No basement', traitReq: 0, traitMask: TRAIT.basement },
        ],
      },
    ],
  },
  { id: STRUCT.Monument, name: 'Ocean monument', dim: 'overworld' },
  { id: STRUCT.Mansion, name: 'Woodland mansion', dim: 'overworld', note: 'Very rare - expect long searches at small radii' },
  { id: STRUCT.Ancient_City, name: 'Ancient city', dim: 'overworld' },
  { id: STRUCT.Trial_Chambers, name: 'Trial chamber', dim: 'overworld' },
  { id: STRUCT.Trail_Ruins, name: 'Trail ruins', dim: 'overworld' },
  { id: STRUCT.Ocean_Ruin, name: 'Ocean ruin', dim: 'overworld' },
  { id: STRUCT.Shipwreck, name: 'Shipwreck', dim: 'overworld' },
  { id: STRUCT.Treasure, name: 'Buried treasure', dim: 'overworld' },
  { id: STRUCT.Mineshaft, name: 'Mineshaft', dim: 'overworld', note: 'Position is the generation attempt, not the entrance' },
  { id: STRUCT.Desert_Well, name: 'Desert well', dim: 'overworld' },
  {
    id: STRUCT.Geode,
    name: 'Amethyst geode',
    dim: 'overworld',
    variants: [
      {
        key: 'cracked',
  javaOnly: true,
        label: 'Crack',
        experimental: true,
        options: [
          ANY,
          { value: 'yes', label: 'Cracked (budding exposed)', traitReq: TRAIT.cracked, traitMask: TRAIT.cracked },
          { value: 'no', label: 'Not cracked', traitReq: 0, traitMask: TRAIT.cracked },
        ],
      },
    ],
  },
  {
    id: STRUCT.Stronghold,
    name: 'Stronghold',
    dim: 'overworld',
    note: 'The first ring never generates closer than ~1280 blocks. Slow to search.',
    variants: [STRONGHOLD_RING],
  },
  {
    id: STRUCT.Fortress,
    name: 'Nether fortress',
    dim: 'nether',
    note: 'Distance is measured in Nether coordinates',
  },
  {
    id: STRUCT.Bastion,
    name: 'Bastion remnant',
    dim: 'nether',
    note: 'Distance is measured in Nether coordinates',
    variants: [BASTION_TYPE],
  },
  {
    id: STRUCT.Nether_Complex,
    name: 'Nether fortress or bastion',
    dim: 'nether',
    note: 'Bedrock puts both on one grid and builds one of them per site, so the spot is exact but which of the two it is cannot be told apart. Distance is measured in Nether coordinates.',
    bedrockOnly: true,
  },
  {
    id: STRUCT.Ruined_Portal_N,
    name: 'Nether ruined portal',
    dim: 'nether',
    note: 'Distance is measured in Nether coordinates',
    variants: [RUINED_PORTAL_TYPE, RUINED_PORTAL_PLACEMENT, RUINED_PORTAL_TEMPLATE],
  },
  { id: STRUCT.End_City, name: 'End city', dim: 'end', note: 'Never generates within 1008 blocks of the End origin' },
  { id: STRUCT.End_Gateway, name: 'End gateway', dim: 'end' },
] as const;

export function structureById(id: number): StructureDef | undefined {
  return STRUCTURES.find((s) => s.id === id);
}

export function structureName(id: number): string {
  return structureById(id)?.name ?? `#${id}`;
}
