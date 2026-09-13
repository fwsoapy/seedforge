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
}

export interface VariantGroup {
  readonly key: string;
  readonly label: string;
  /** Shown with an "experimental" warning in the UI. */
  readonly experimental?: boolean;
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
}

const ANY: VariantOption = { value: null, label: 'Any' };

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
    variants: [
      {
        key: 'shape',
        label: 'Portal shape',
        experimental: true,
        options: [
          ANY,
          { value: 'giant', label: 'Giant portal', traitReq: TRAIT.giant, traitMask: TRAIT.giant },
          { value: 'normal', label: 'Normal size', traitReq: 0, traitMask: TRAIT.giant },
          { value: 'buried', label: 'Underground', traitReq: TRAIT.underground, traitMask: TRAIT.underground },
          { value: 'surface', label: 'Surface', traitReq: 0, traitMask: TRAIT.underground },
        ],
      },
    ],
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
  { id: STRUCT.Stronghold, name: 'Stronghold', dim: 'overworld', note: 'The first ring never generates closer than ~1280 blocks' },
  { id: STRUCT.Fortress, name: 'Nether fortress', dim: 'nether', note: 'Distance is measured in Nether coordinates' },
  { id: STRUCT.Bastion, name: 'Bastion remnant', dim: 'nether', note: 'Distance is measured in Nether coordinates' },
  { id: STRUCT.Ruined_Portal_N, name: 'Ruined portal (Nether)', dim: 'nether', note: 'Distance is measured in Nether coordinates' },
  { id: STRUCT.End_City, name: 'End city', dim: 'end', note: 'Never generates within 1008 blocks of the End origin' },
  { id: STRUCT.End_Gateway, name: 'End gateway', dim: 'end' },
] as const;

export function structureById(id: number): StructureDef | undefined {
  return STRUCTURES.find((s) => s.id === id);
}

export function structureName(id: number): string {
  return structureById(id)?.name ?? `#${id}`;
}
