/** Biome ids (cubiomes/biomes.h). */
export const BIOME = {
  mushroom_fields: 14,
  ice_spikes: 140,
  dripstone_caves: 174,
  lush_caves: 175,
  deep_dark: 183,
  mangrove_swamp: 184,
  cherry_grove: 185,
  pale_garden: 186,
  bamboo_jungle: 168,
  badlands: 37,
  jungle: 21,
  dark_forest: 29,
  // village variants
  plains: 1,
  desert: 2,
  taiga: 5,
  snowy_tundra: 12,
  savanna: 35,
  meadow: 177,
} as const;

const VILLAGE_NAMES: Record<number, string> = {
  [BIOME.plains]: 'Plains',
  [BIOME.desert]: 'Desert',
  [BIOME.taiga]: 'Taiga',
  [BIOME.snowy_tundra]: 'Snowy',
  [BIOME.savanna]: 'Savanna',
  [BIOME.meadow]: 'Meadow',
};

export function biomeName(id: number): string | null {
  return VILLAGE_NAMES[id] ?? null;
}

export interface BiomeDef {
  readonly id: number;
  readonly name: string;
  /**
   * Block height the grid is sampled at. Cave biomes only exist underground,
   * so sampling at sea level would never find them.
   */
  readonly sampleY: number;
  readonly note?: string;
}

/**
 * Biomes offered as search criteria. This is a curated list of the ones people
 * actually hunt for, not every biome cubiomes knows - version availability is
 * checked at runtime through `sf_biome_supported()`.
 */
export const SEARCHABLE_BIOMES: readonly BiomeDef[] = [
  { id: BIOME.deep_dark, name: 'Deep dark', sampleY: -52, note: 'Where ancient cities and wardens live' },
  { id: BIOME.lush_caves, name: 'Lush caves', sampleY: -32 },
  { id: BIOME.dripstone_caves, name: 'Dripstone caves', sampleY: -32 },
  { id: BIOME.mushroom_fields, name: 'Mushroom fields', sampleY: 63 },
  { id: BIOME.cherry_grove, name: 'Cherry grove', sampleY: 100 },
  { id: BIOME.ice_spikes, name: 'Ice spikes', sampleY: 80 },
  { id: BIOME.mangrove_swamp, name: 'Mangrove swamp', sampleY: 63 },
  { id: BIOME.bamboo_jungle, name: 'Bamboo jungle', sampleY: 70 },
  { id: BIOME.pale_garden, name: 'Pale garden', sampleY: 80 },
  { id: BIOME.jungle, name: 'Jungle', sampleY: 70 },
  { id: BIOME.badlands, name: 'Badlands', sampleY: 80 },
  { id: BIOME.dark_forest, name: 'Dark forest', sampleY: 70 },
] as const;

export function biomeById(id: number): BiomeDef | undefined {
  return SEARCHABLE_BIOMES.find((b) => b.id === id);
}
