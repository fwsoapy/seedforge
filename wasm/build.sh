#!/usr/bin/env bash
# Builds the Cubiomes-backed search core to WebAssembly.
#
# Requires the Emscripten SDK on PATH (emcc). See README for setup.
# Output: src/wasm/seedforge.js + seedforge.wasm (ES module, loadable from a
# Web Worker).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/vendor/cubiomes"
PATCHES="$ROOT/vendor/patches"
BUILD="$ROOT/build/cubiomes"
CUBIOMES="$BUILD"
OUT="$ROOT/src/wasm"

if [ ! -f "$UPSTREAM/finders.c" ]; then
  echo "vendor/cubiomes is empty - run: git submodule update --init --recursive" >&2
  exit 1
fi

mkdir -p "$OUT"

# Upstream cubiomes stops at the 1.21 Winter Drop. Build from a patched copy so
# the pinned submodule itself is never modified - see vendor/patches/README.md.
rm -rf "$BUILD"
mkdir -p "$(dirname "$BUILD")"
cp -r "$UPSTREAM" "$BUILD"
cp "$PATCHES/btree21_5.h" "$BUILD/tables/"
patch -s -p1 -d "$BUILD" < "$PATCHES/versions.patch"
echo "applied vendor/patches/versions.patch"

SRC=(
  "$ROOT/wasm/bindings.c"
  "$CUBIOMES/noise.c"
  "$CUBIOMES/biomes.c"
  "$CUBIOMES/layers.c"
  "$CUBIOMES/biomenoise.c"
  "$CUBIOMES/generator.c"
  "$CUBIOMES/finders.c"
  "$CUBIOMES/util.c"
  "$CUBIOMES/quadbase.c"
)

EXPORTED_FUNCTIONS='["_sf_configure","_sf_run","_sf_supported","_sf_region_size","_sf_mc_newest","_sf_stat_scanned","_sf_stat_stage2","_sf_max_crit","_sf_crit_ints","_sf_biome_supported","_sf_pair_ints","_sf_max_pairs","_sf_spawn","_malloc","_free"]'

emcc "${SRC[@]}" \
  -I"$CUBIOMES" \
  -O3 \
  -flto \
  -DNDEBUG \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -sEXPORTED_RUNTIME_METHODS='["HEAP32","HEAPU8","HEAPU32","HEAPF64","getValue","setValue"]' \
  -sFILESYSTEM=0 \
  -sEXPORT_NAME=createSeedForge \
  -o "$OUT/seedforge.js"

echo "built -> $OUT/seedforge.js"
