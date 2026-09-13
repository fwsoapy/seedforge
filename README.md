# SeedForge

**Find Minecraft Java Edition seeds with the structures and biomes you want, near spawn.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-5ac36a.svg)](https://fwsoapy.github.io/seedforge/)
[![Powered by Cubiomes](https://img.shields.io/badge/powered%20by-Cubiomes-blue.svg)](https://github.com/Cubitect/cubiomes)

SeedForge searches for Minecraft seeds where everything you ask for generates
within a distance you choose of world spawn. Tick village, ruined portal and
deep dark, set the radius to 500 blocks, hit search, and it hands you seeds that
satisfy all three at once.

It runs entirely in your browser. There is no seed database, no backend, no
account and nothing leaves your machine.

**Live demo:** https://fwsoapy.github.io/seedforge/

![SeedForge searching for a village, a ruined portal and an ancient city within 500 blocks of spawn](docs/screenshot.png)

## Features

- **Multi-criteria search.** Pick as many structures as you like. A seed only
  counts when *every* one of them has at least one instance inside the radius.
- **Biome criteria too.** Hunt for the deep dark (wardens and ancient cities),
  lush caves, dripstone caves, mushroom fields, cherry groves, ice spikes and
  more, alongside your structure picks.
- **Variant filters.** Village biome type (plains, desert, savanna, taiga,
  snowy) and zombie villages are exact. Village size, giant/underground ruined
  portals, igloo basements and cracked geodes are available as clearly labelled
  best-effort filters.
- **Any distance you want.** Defaults to 500 blocks, adjustable from 16 blocks
  to a whole continent.
- **Measure from where it matters.** World origin (fastest), estimated world
  spawn, or the exact world spawn (slowest but accurate).
- **All three dimensions.** Nether fortresses, bastions and End cities are
  searchable alongside overworld structures.
- **Version aware.** Pick anything from 1.7 to 1.21; the structure list changes
  to match what actually exists in that version.
- **Multi-threaded.** One Web Worker per logical CPU, each scanning its own
  stripe of the seed space.
- **Streaming results.** Matches appear as they are found, with a live
  seeds-scanned counter and a stop button. A bad filter combination never
  freezes the page.
- **Private by design.** 100% client-side. No API keys, no analytics, no data
  collection.

## How it works

Minecraft's world generation is deterministic: given a seed, the position of
every structure is fixed and computable without generating a single chunk.

Structure placement uses a region grid. The world is divided into regions of
*N* chunks on a side, and within each region one generation attempt position is
derived from the region coordinates, the world seed, and a salt constant unique
to that structure type. That gives a candidate position with nothing but a few
RNG steps. Whether a structure actually generates there is then decided by a
biome check (and, for a handful of 1.18+ structures, a surface-height check).

SeedForge does this in two stages, which is where the speed comes from:

1. **Cheap stage.** For each candidate seed, compute the generation attempt
   positions for every selected structure and throw the seed away immediately
   unless all of them have a hit inside the radius. This is pure integer math.
2. **Expensive stage.** Only for the survivors, build the biome generator for
   that seed and confirm each position with a real biome check, plus any
   variant constraints you asked for.

Only the low 48 bits of a world seed affect structure placement; the upper 16
bits only change biome generation. The search therefore walks the 48-bit space,
which is why returned seeds are positive numbers below 2^48. They are ordinary,
fully valid Minecraft seeds - paste them straight into the world creation
screen.

All of that math comes from [Cubiomes](https://github.com/Cubitect/cubiomes), a
C reimplementation of Minecraft Java Edition's biome and structure generation,
compiled to WebAssembly. SeedForge does not reimplement the generation itself,
and it does not store precomputed seeds anywhere.

## Supported Minecraft versions

SeedForge supports every version Cubiomes does, which currently tops out at the
1.21 Winter Drop. Newer releases arrive here when Cubiomes adds them upstream -
generation changes have to be reimplemented there first, and guessing at them
would just produce wrong seeds.


| Version | Notable structures added |
| --- | --- |
| 1.7 - 1.12 | Villages, temples, witch huts, igloos (1.9+), monuments (1.8+), mansions (1.11+) |
| 1.13 | Ocean ruins, shipwrecks, buried treasure |
| 1.14 | Village overhaul (biome types), pillager outposts |
| 1.15 | - |
| 1.16 | Ruined portals, bastion remnants, nether fortress relocation |
| 1.17 | Amethyst geodes |
| 1.18 | World generation overhaul (noise-based biomes) |
| 1.19 | Ancient cities, trail ruins (1.19.4+) |
| 1.20 | - |
| 1.21 | Trial chambers |

The dropdown offers 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16.1,
1.16.5, 1.17, 1.18, 1.19.2, 1.19.4, 1.20, 1.21.1, 1.21.3 and the 1.21 Winter
Drop. Which structures appear is decided by Cubiomes itself rather than a
hardcoded table, so the list is always consistent with the generation code that
actually runs.

## Tech stack

| Layer | Choice |
| --- | --- |
| Generation math | [Cubiomes](https://github.com/Cubitect/cubiomes) (C, MIT), as a git submodule |
| Bindings | `wasm/bindings.c` - a thin C layer exposing a chunked search |
| Compilation | Emscripten to WebAssembly |
| Frontend | TypeScript, no framework |
| Bundler | Vite |
| Concurrency | Web Workers, one per logical CPU |
| Tests | Vitest, running against the real WASM build |
| Hosting | GitHub Pages via GitHub Actions |

## Local development

You need Node 20+, a C toolchain and the
[Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html).

```bash
# 1. clone with the Cubiomes submodule
git clone https://github.com/fwsoapy/seedforge.git
cd seedforge
git submodule update --init --recursive

# 2. install the Emscripten SDK (once)
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install latest
~/emsdk/emsdk activate latest
source ~/emsdk/emsdk_env.sh

# 3. build the WebAssembly core
npm install
npm run build:wasm        # -> src/wasm/seedforge.{js,wasm}

# 4. run it
npm run dev               # http://localhost:5173/seedforge/
```

Other scripts:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest, needs build:wasm first
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve dist/
```

`src/wasm/` is generated output and is not checked into git - run
`npm run build:wasm` after a fresh clone, and again whenever you change
`wasm/bindings.c` or update the submodule.

## Usage

1. Pick your Minecraft version.
2. Set the maximum distance from spawn (500 blocks by default).
3. Choose what you are measuring from. "Estimated world spawn" is the sensible
   default; "world origin" is faster; "exact world spawn" is slower but matches
   what the game actually does.
4. Tick the structures you want. Leave a variant dropdown on **Any** when you
   do not care - the structure still has to exist inside the radius, just
   without a type constraint.
5. Hit **Search seeds**. Results stream in as they are found; **Stop** halts
   the search at any time.
6. Copy a seed and paste it into the Minecraft world creation screen.

If a search runs for a long time with no hits, the filter combination is
probably very rare. Widen the radius, drop a structure, or relax a variant
filter. Woodland mansions, ancient cities and End cities are the usual
suspects.

### Under Advanced

- **Start seed** - where the scan begins. Blank means a random 48-bit start,
  so two people running the same query get different seeds.
- **Stop after N matches** - the search halts once it has that many.
- **Worker threads** - defaults to `navigator.hardwareConcurrency`.

## Known limitations

- In 1.18 and later, desert pyramids, jungle temples and woodland mansions also
  depend on surface height at their bounding-box corners. Cubiomes approximates
  that check from noise parameters, so rare false positives are possible.
- "Estimated world spawn" can differ from the real in-game spawn by a few dozen
  blocks, because the game's final spawn search depends on block-level terrain.
- Nether structure distances are measured in Nether coordinates, from the
  Nether-side equivalent of the target point (x/8, z/8).
- Village size is **experimental**. Cubiomes exposes the village's starting
  meeting-point piece, and its footprint is what the size filter buckets on.
  The jigsaw expansion that decides the real final size is not modelled, so
  treat it as a hint rather than a guarantee. It is labelled as such in the UI.
  Village biome type and zombie villages, by contrast, are exact.
- Strongholds never generate closer than about 1280 blocks, and End cities never
  within 1008 blocks of the End origin. Asking for either at a small radius will
  never match.
- **Ravines and individual caves are not searchable.** They are carvers, cut
  into terrain per chunk during world generation, not region-grid structures,
  and Cubiomes does not model them. The closest available thing is the **lush
  caves** and **dripstone caves** biome criteria, which do find large cave
  systems.
- Biome criteria are **sampled on a grid** - 1:16 for normal radii, coarser for
  very large ones. A biome patch smaller than the sample spacing can be stepped
  over, so a biome search can miss a small patch. It never invents one. Biome
  searches are also noticeably slower than structure searches.
- Ore placement is not searchable at all.

Always verify a seed in-game before committing a world to it.

## Roadmap

- [x] Biome criteria alongside structures
- [ ] Cluster/quad searches (e.g. four witch huts in one perimeter)
- [ ] Shareable search URLs
- [ ] Export results as JSON/CSV
- [ ] Bedrock Edition support (blocked on generation differences Cubiomes does
      not model)
- [ ] An inline map preview of the surrounding biomes for a chosen seed

## Contributing

Bug reports and pull requests are welcome - see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT - see [LICENSE](LICENSE). Third-party licenses are listed in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Credits

- **[Cubiomes](https://github.com/Cubitect/cubiomes) by
  [Cubitect](https://github.com/Cubitect)** - the entire generation engine
  behind this tool. SeedForge is a UI on top of Cubitect's work; if you find
  this useful, go star that repository.
- [Emscripten](https://emscripten.org/) for the C-to-WebAssembly toolchain.
- Mojang Studios, for a world generator that happens to be reproducible.

## Disclaimer

SeedForge is an unofficial fan-made tool. It is not affiliated with, endorsed
by, or associated with Mojang Studios or Microsoft. "Minecraft" is a trademark
of Mojang Synergies AB.

Results are computed estimates. They are derived from a reimplementation of
Minecraft's generation algorithms and have known edge-case limitations (see
above). Verify in-game before relying on a seed.
