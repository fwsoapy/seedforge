/** Biome ids (cubiomes/biomes.h). */
export const BIOME = {
  ocean: 0,
  plains: 1,
  desert: 2,
  forest: 4,
  taiga: 5,
  swamp: 6,
  snowy_tundra: 12,
  snowy_plains: 12, // modern name for the same biome
  mushroom_fields: 14,
  beach: 16,
  jungle: 21,
  birch_forest: 27,
  dark_forest: 29,
  savanna: 35,
  badlands: 37,
  sunflower_plains: 129,
  flower_forest: 132,
  ice_spikes: 140,
  old_growth_birch_forest: 155,
  eroded_badlands: 165,
  bamboo_jungle: 168,
  dripstone_caves: 174,
  lush_caves: 175,
  meadow: 177,
  jagged_peaks: 180,
  deep_dark: 183,
  mangrove_swamp: 184,
  cherry_grove: 185,
  pale_garden: 186,
  sulfur_caves: 187,
} as const;

const VILLAGE_NAMES: Record<number, string> = {
  [BIOME.plains]: 'Plains',
  [BIOME.desert]: 'Desert',
  [BIOME.taiga]: 'Taiga',
  [BIOME.snowy_plains]: 'Snowy',
  [BIOME.savanna]: 'Savanna',
  [BIOME.meadow]: 'Meadow',
};

export function biomeName(id: number): string | null {
  return VILLAGE_NAMES[id] ?? null;
}

/** The two headings the biome picker renders under. */
export const BIOME_GROUPS = [
  { key: 'popular', label: 'Popular' },
  { key: 'exotic', label: 'Exotic' },
] as const;

export type BiomeGroup = (typeof BIOME_GROUPS)[number]['key'];

export interface BiomeDef {
  readonly id: number;
  readonly name: string;
  readonly group: BiomeGroup;
  /**
   * Block height the grid is sampled at. Biomes are three-dimensional from
   * 1.18 on, so a cave biome sampled at sea level or a peak sampled at y=63
   * would simply never be found. Every value here was checked against the
   * real generator.
   */
  readonly sampleY: number;
  readonly note?: string;
}

/**
 * Biomes offered as search criteria - the ones people commonly want, plus the
 * ones worth going looking for. Version availability is not hardcoded; it is
 * checked at runtime through `sf_biome_supported()`, so older versions
 * automatically hide what did not exist yet.
 */
export const SEARCHABLE_BIOMES: readonly BiomeDef[] = [
  // --- popular ---
  { id: BIOME.plains, name: 'Plains', group: 'popular', sampleY: 70 },
  { id: BIOME.forest, name: 'Forest', group: 'popular', sampleY: 70 },
  { id: BIOME.birch_forest, name: 'Birch forest', group: 'popular', sampleY: 70 },
  { id: BIOME.dark_forest, name: 'Dark forest', group: 'popular', sampleY: 70 },
  { id: BIOME.taiga, name: 'Taiga', group: 'popular', sampleY: 70 },
  { id: BIOME.desert, name: 'Desert', group: 'popular', sampleY: 70 },
  { id: BIOME.savanna, name: 'Savanna', group: 'popular', sampleY: 70 },
  { id: BIOME.jungle, name: 'Jungle', group: 'popular', sampleY: 70 },
  { id: BIOME.swamp, name: 'Swamp', group: 'popular', sampleY: 63 },
  { id: BIOME.snowy_plains, name: 'Snowy plains', group: 'popular', sampleY: 70 },
  { id: BIOME.meadow, name: 'Meadow', group: 'popular', sampleY: 100 },
  { id: BIOME.ocean, name: 'Ocean', group: 'popular', sampleY: 50 },
  { id: BIOME.beach, name: 'Beach', group: 'popular', sampleY: 63 },

  // --- exotic ---
  { id: BIOME.mushroom_fields, name: 'Mushroom fields', group: 'exotic', sampleY: 70 },
  { id: BIOME.cherry_grove, name: 'Cherry grove', group: 'exotic', sampleY: 100 },
  { id: BIOME.ice_spikes, name: 'Ice spikes', group: 'exotic', sampleY: 80 },
  { id: BIOME.flower_forest, name: 'Flower forest', group: 'exotic', sampleY: 70 },
  { id: BIOME.old_growth_birch_forest, name: 'Old growth birch forest', group: 'exotic', sampleY: 70 },
  { id: BIOME.bamboo_jungle, name: 'Bamboo jungle', group: 'exotic', sampleY: 70 },
  { id: BIOME.mangrove_swamp, name: 'Mangrove swamp', group: 'exotic', sampleY: 63 },
  { id: BIOME.pale_garden, name: 'Pale garden', group: 'exotic', sampleY: 80 },
  { id: BIOME.badlands, name: 'Badlands', group: 'exotic', sampleY: 80 },
  { id: BIOME.eroded_badlands, name: 'Eroded badlands', group: 'exotic', sampleY: 90 },
  { id: BIOME.jagged_peaks, name: 'Jagged peaks', group: 'exotic', sampleY: 190 },
  { id: BIOME.deep_dark, name: 'Deep dark', group: 'exotic', sampleY: -52, note: 'Where ancient cities and wardens live' },
  { id: BIOME.sulfur_caves, name: 'Sulfur caves', group: 'exotic', sampleY: -16, note: 'Added in 26.2, home to sulfur cubes' },
  { id: BIOME.lush_caves, name: 'Lush caves', group: 'exotic', sampleY: -32 },
  { id: BIOME.dripstone_caves, name: 'Dripstone caves', group: 'exotic', sampleY: -32 },
] as const;

export function biomeById(id: number): BiomeDef | undefined {
  return SEARCHABLE_BIOMES.find((b) => b.id === id);
}
