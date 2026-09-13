# Contributing to SeedForge

Thanks for taking a look. Bug reports, structure/variant additions and UI fixes
are all welcome.

## Getting set up

```bash
git clone https://github.com/fwsoapy/seedforge.git
cd seedforge
git submodule update --init --recursive
npm install
npm run build:wasm     # needs the Emscripten SDK on PATH
npm run dev
```

The README has full Emscripten setup instructions. `src/wasm/` is generated and
gitignored; rebuild it after changing `wasm/bindings.c` or bumping the Cubiomes
submodule.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

Tests run against the real WebAssembly build, so `npm run build:wasm` has to
have succeeded first.

## Where things live

| Path | What it is |
| --- | --- |
| `vendor/cubiomes` | Cubiomes submodule. Don't patch it here - send fixes upstream. |
| `wasm/bindings.c` | The C search driver exposed to JavaScript. |
| `wasm/build.sh` | Emscripten build. |
| `src/data/` | Structure catalogue, variant options, version list. |
| `src/search/` | Criteria encoding, the typed WASM wrapper, the worker pool. |
| `src/worker.ts` | Per-thread search loop. |
| `src/ui/` | Picker, results, styles. |
| `tests/` | Vitest suites, including integration tests against the WASM core. |

## Adding a structure

1. Add its id (from cubiomes' `StructureType` enum) to `STRUCT` in
   `src/data/structures.ts` and add an entry to `STRUCTURES`.
2. If it lives in the Nether or the End, set `dim` accordingly - the C side
   already routes dimensions via `sf_dim_of()`.
3. Don't add version gating by hand. `sf_supported()` asks Cubiomes, which
   keeps the UI honest automatically.
4. Add a case to `tests/search.test.ts` if the structure has behaviour worth
   pinning down.

## Adding a variant filter

Variant traits come from cubiomes' `getVariant()`. Add a bit to `SF_TRAIT_*` in
`wasm/bindings.c`, map it in `sf_traits_ok()`, mirror it in `TRAIT` in
`src/data/structures.ts`, then add the dropdown options.

If a filter is not exact - because Cubiomes approximates it, or because the
underlying check needs terrain data that is not modelled - mark the group
`experimental: true` so the UI says so. Please don't ship a guess as a fact.

## Style

- TypeScript strict mode, no `any` in application code.
- Plain DOM, no framework.
- Comments explain *why*, not *what*.
- Keep the C side allocation-free inside the search loop.

## Reporting a wrong result

Seed accuracy bugs are the most valuable reports. Please include:

- the seed, the Minecraft version and the exact search settings
- what SeedForge reported
- what the game (or Chunkbase / an in-game `/locate`) actually shows

If the mismatch comes from generation math rather than from this tool's
filtering, it likely belongs upstream in
[Cubiomes](https://github.com/Cubitect/cubiomes) - mention it here either way
and we'll work out which.

## License

By contributing you agree that your contributions are licensed under the MIT
license, as per [LICENSE](LICENSE).
