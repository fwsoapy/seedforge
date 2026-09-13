# Third-party licenses

SeedForge bundles code from the projects below. Their license terms apply to
the parts of the build that come from them.

---

## Cubiomes

- Upstream: https://github.com/Cubitect/cubiomes
- Author: Cubitect
- Vendored at: `vendor/cubiomes` (git submodule)
- Used for: all Minecraft biome and structure generation math. Compiled to
  WebAssembly and shipped inside `seedforge.wasm`.

```
MIT License

Copyright (c) 2020 Cubitect

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Emscripten

- Upstream: https://github.com/emscripten-core/emscripten
- Used for: compiling Cubiomes and `wasm/bindings.c` to WebAssembly. A small
  amount of Emscripten runtime glue is emitted into `seedforge.js`.
- Licensed under the MIT license and the University of Illinois/NCSA Open
  Source License. See
  https://github.com/emscripten-core/emscripten/blob/main/LICENSE.

---

## Build-time dependencies

Vite, TypeScript and Vitest are used to build and test the frontend. They are
MIT licensed and are not shipped in the deployed output beyond the code they
generate. See `package.json` and `npm ls` for exact versions.
