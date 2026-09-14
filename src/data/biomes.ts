/** Biome ids (cubiomes/biomes.h). */
export const BIOME = {
  // surface
  ocean: 0,
  plains: 1,
  desert: 2,
  windswept_hills: 3,
  forest: 4,
  taiga: 5,
  swamp: 6,
  river: 7,
  frozen_ocean: 10,
  frozen_river: 11,
  snowy_plains: 12,
  mushroom_fields: 14,
  beach: 16,
  jungle: 21,
  sparse_jungle: 23,
  deep_ocean: 24,
  stony_shore: 25,
  snowy_beach: 26,
  birch_forest: 27,
  dark_forest: 29,
  snowy_taiga: 30,
  old_growth_pine_taiga: 32,
  windswept_forest: 34,
  savanna: 35,
  savanna_plateau: 36,
  badlands: 37,
  wooded_badlands: 38,
  warm_ocean: 44,
  lukewarm_ocean: 45,
  cold_ocean: 46,
  deep_lukewarm_ocean: 48,
  deep_cold_ocean: 49,
  deep_frozen_ocean: 50,
  // variants (base + 128)
  sunflower_plains: 129,
  flower_forest: 132,
  ice_spikes: 140,
  old_growth_birch_forest: 155,
  old_growth_spruce_taiga: 160,
  windswept_gravelly_hills: 131,
  windswept_savanna: 163,
  eroded_badlands: 165,
  // 1.14+
  bamboo_jungle: 168,
  dripstone_caves: 174,
  lush_caves: 175,
  meadow: 177,
  grove: 178,
  snowy_slopes: 179,
  jagged_peaks: 180,
  frozen_peaks: 181,
  stony_peaks: 182,
  deep_dark: 183,
  mangrove_swamp: 184,
  cherry_grove: 185,
  pale_garden: 186,
  sulfur_caves: 187,
  // village variants use these too
  snowy_tundra: 12,
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

/** Groups the biome picker renders under their own headings. */
export const BIOME_GROUPS = [
  { key: 'common', label: 'Common' },
  { key: 'forest', label: 'Forests & jungle' },
  { key: 'cold', label: 'Cold & mountain' },
  { key: 'dry', label: 'Dry' },
  { key: 'water', label: 'Water & shore' },
  { key: 'cave', label: 'Caves' },
  { key: 'rare', label: 'Rare' },
] as const;

export type BiomeGroup = (typeof BIOME_GROUPS)[number]['key'];

export interface BiomeDef {
  readonly id: number;
  readonly name: string;
  readonly group: BiomeGroup;
  /**
   * Block height the grid is sampled at. Biomes are three-dimensional from
   * 1.18 on, so a cave biome sampled at sea level or a peak sampled at y=63
   * would simply never be found.
   */
  readonly sampleY: number;
  readonly note?: string;
}

/**
 * Biomes offered as search criteria. Version availability is not hardcoded -
 * it is checked at runtime through `sf_biome_supported()`, so older versions
 * automatically hide what did not exist yet.
 */
export const SEARCHABLE_BIOMES: readonly BiomeDef[] = [
  // --- common ---
  { id: BIOME.plains, name: 'Plains', group: 'common', sampleY: 70 },
  { id: BIOME.forest, name: 'Forest', group: 'common', sampleY: 70 },
  { id: BIOME.taiga, name: 'Taiga', group: 'common', sampleY: 70 },
  { id: BIOME.desert, name: 'Desert', group: 'common', sampleY: 70 },
  { id: BIOME.savanna, name: 'Savanna', group: 'common', sampleY: 70 },
  { id: BIOME.swamp, name: 'Swamp', group: 'common', sampleY: 63 },
  { id: BIOME.jungle, name: 'Jungle', group: 'common', sampleY: 70 },
  { id: BIOME.snowy_plains, name: 'Snowy plains', group: 'common', sampleY: 70 },

  // --- forests ---
  { id: BIOME.birch_forest, name: 'Birch forest', group: 'forest', sampleY: 70 },
  { id: BIOME.old_growth_birch_forest, name: 'Old growth birch forest', group: 'forest', sampleY: 70 },
  { id: BIOME.dark_forest, name: 'Dark forest', group: 'forest', sampleY: 70 },
  { id: BIOME.flower_forest, name: 'Flower forest', group: 'forest', sampleY: 70 },
  { id: BIOME.old_growth_pine_taiga, name: 'Old growth pine taiga', group: 'forest', sampleY: 70 },
  { id: BIOME.old_growth_spruce_taiga, name: 'Old growth spruce taiga', group: 'forest', sampleY: 70 },
  { id: BIOME.sparse_jungle, name: 'Sparse jungle', group: 'forest', sampleY: 70 },
  { id: BIOME.bamboo_jungle, name: 'Bamboo jungle', group: 'forest', sampleY: 70 },
  { id: BIOME.mangrove_swamp, name: 'Mangrove swamp', group: 'forest', sampleY: 63 },
  { id: BIOME.pale_garden, name: 'Pale garden', group: 'forest', sampleY: 80 },

  // --- cold & mountain ---
  { id: BIOME.snowy_taiga, name: 'Snowy taiga', group: 'cold', sampleY: 70 },
  { id: BIOME.windswept_hills, name: 'Windswept hills', group: 'cold', sampleY: 100 },
  { id: BIOME.windswept_forest, name: 'Windswept forest', group: 'cold', sampleY: 100 },
  { id: BIOME.windswept_gravelly_hills, name: 'Windswept gravelly hills', group: 'cold', sampleY: 100 },
  { id: BIOME.meadow, name: 'Meadow', group: 'cold', sampleY: 100 },
  { id: BIOME.grove, name: 'Grove', group: 'cold', sampleY: 140 },
  { id: BIOME.snowy_slopes, name: 'Snowy slopes', group: 'cold', sampleY: 150 },
  { id: BIOME.jagged_peaks, name: 'Jagged peaks', group: 'cold', sampleY: 190 },
  { id: BIOME.frozen_peaks, name: 'Frozen peaks', group: 'cold', sampleY: 190 },
  { id: BIOME.stony_peaks, name: 'Stony peaks', group: 'cold', sampleY: 150 },

  // --- dry ---
  { id: BIOME.sunflower_plains, name: 'Sunflower plains', group: 'dry', sampleY: 70 },
  { id: BIOME.savanna_plateau, name: 'Savanna plateau', group: 'dry', sampleY: 90 },
  { id: BIOME.windswept_savanna, name: 'Windswept savanna', group: 'dry', sampleY: 90 },
  { id: BIOME.badlands, name: 'Badlands', group: 'dry', sampleY: 80 },
  { id: BIOME.wooded_badlands, name: 'Wooded badlands', group: 'dry', sampleY: 100 },
  { id: BIOME.eroded_badlands, name: 'Eroded badlands', group: 'dry', sampleY: 90 },

  // --- water & shore ---
  { id: BIOME.ocean, name: 'Ocean', group: 'water', sampleY: 50 },
  { id: BIOME.deep_ocean, name: 'Deep ocean', group: 'water', sampleY: 50 },
  { id: BIOME.warm_ocean, name: 'Warm ocean', group: 'water', sampleY: 50 },
  { id: BIOME.lukewarm_ocean, name: 'Lukewarm ocean', group: 'water', sampleY: 50 },
  { id: BIOME.cold_ocean, name: 'Cold ocean', group: 'water', sampleY: 50 },
  { id: BIOME.frozen_ocean, name: 'Frozen ocean', group: 'water', sampleY: 50 },
  { id: BIOME.deep_frozen_ocean, name: 'Deep frozen ocean', group: 'water', sampleY: 50 },
  { id: BIOME.river, name: 'River', group: 'water', sampleY: 63 },
  { id: BIOME.frozen_river, name: 'Frozen river', group: 'water', sampleY: 63 },
  { id: BIOME.beach, name: 'Beach', group: 'water', sampleY: 63 },
  { id: BIOME.snowy_beach, name: 'Snowy beach', group: 'water', sampleY: 63 },
  { id: BIOME.stony_shore, name: 'Stony shore', group: 'water', sampleY: 63 },

  // --- caves ---
  { id: BIOME.deep_dark, name: 'Deep dark', group: 'cave', sampleY: -52, note: 'Where ancient cities and wardens live' },
  { id: BIOME.sulfur_caves, name: 'Sulfur caves', group: 'cave', sampleY: -16, note: 'Added in 26.2, home to sulfur cubes' },
  { id: BIOME.lush_caves, name: 'Lush caves', group: 'cave', sampleY: -32 },
  { id: BIOME.dripstone_caves, name: 'Dripstone caves', group: 'cave', sampleY: -32 },

  // --- rare ---
  { id: BIOME.mushroom_fields, name: 'Mushroom fields', group: 'rare', sampleY: 70 },
  { id: BIOME.ice_spikes, name: 'Ice spikes', group: 'rare', sampleY: 80 },
  { id: BIOME.cherry_grove, name: 'Cherry grove', group: 'rare', sampleY: 100 },
] as const;

export function biomeById(id: number): BiomeDef | undefined {
  return SEARCHABLE_BIOMES.find((b) => b.id === id);
}
