# PL Composer

A scoring surface for video pieces. Lay out shots, wire sources through a typed node
graph, and emit a markdown spec that a render CLI turns into video. It exists twice:
a Next.js web board on Cloudflare Workers, and a native Rust app (egui) that emits the
same spec and runs the render itself.

Nothing in either one computes pixels. The graph carries intent; the renderer evaluates.

## Features

- **Pieces and shots.** A piece is an ordered list of shots, each with sources, a
  duration and a transition (cut, dissolve, black, wipe, slide; the native app also
  keeps white).
- **Typed node graph.** Seven socket types (Media, Curve, Audio, Value, Model, Shot,
  Spec), strictly validated, so an invalid wire is refused with a reason. Node kinds:
  source, Blender render, envelope extract, remap, constant, layer, matte and shot.
- **Default wiring.** A shot with no explicit graph is seeded from its attached assets:
  the first media asset is the base, later ones overlay with a `screen` blend, and a 3D
  model is rendered to media before it is composited.
- **Asset library.** Browses the asset index with thumbnails, text search and type chips.
- **Spec output.** The web board shows the exact spec text, with Copy and Download. The
  native app writes the spec and starts the render, streaming its log into the window.
- **Parity between the two.** The Rust core is a port of `lib/emit.ts` and
  `lib/graph.ts`. A harness binary emits the spec from the same inputs so the two can be
  diffed byte for byte.

## Requirements

- Node.js 24 or later (the tests run TypeScript directly through Node's type stripping)
- A Cloudflare account and Wrangler for the web board; it reads its asset index and
  thumbnails from an R2 bucket
- Rust (stable) for the native app
- The render CLI and asset index generator are separate tools and are not in this repo

## Web board

```bash
npm install
npm run preview      # OpenNext build, then a local Workers preview
npm run deploy       # OpenNext build, then wrangler deploy
```

`npm run dev` starts `next dev`, but the asset index lives in R2 and `next dev` has no
Cloudflare context, so the library endpoint answers 503 there. Use `npm run preview` to
see real assets.

The board reads two JSON objects under `composer/` in the bound R2 bucket, the asset
index and `thumbs.json`, and never writes them. Thumbnails are optional.

## Native app

```bash
cd native
cargo run --release --bin pl-composer-native   # the app
cargo run --release --bin emit-spec -- <piece.json> <index.json> <out.spec.md> [--created "<stamp>"]
cargo test
```

The asset index, render script and Python interpreter paths are constants at the top of
`native/src/app.rs`. Set them for your machine before rendering.

## Scripts and tests

```bash
node lib/graph.test.ts                                   # graph round-trip test
node scripts/emit-spec.mjs <piece.json> <index.json> <out.spec.md>
node scripts/apply-gallery-cuts.mjs [--dry]              # drop cut assets from the index
```

`the-practice-v1.piece.json` is a real nine-shot piece, used by the native round-trip
test. That test skips itself, with a printed reason, when the asset index is not on the
machine.

## Project structure

```
app/                 Next.js app router: the board, and two read-only API routes
components/          asset browser, graph canvas (React Flow), spec sheet
lib/                 types, graph rules, spec emitter, round-trip test
scripts/             spec emitter CLI, gallery-cut filter
native/
  src/types.rs, emit.rs, graph.rs   the rules, no UI
  src/bridge.rs                     the one seam to egui-snarl
  src/viewer.rs, app.rs             node canvas and window
  src/bin/emit_spec.rs              parity harness
  tests/piece_round_trip.rs         end-to-end round trip
wrangler.jsonc       Worker and R2 binding
```

## License

All rights reserved. Public to read; no licence is granted to copy, modify or
redistribute. See [LICENSE](LICENSE). Third-party fonts and libraries keep their own
licences.

Made by [Psyched Luxuries](https://psychedluxuries.com).
