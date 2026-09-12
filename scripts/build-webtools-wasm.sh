#!/usr/bin/env bash
# Build the snapdragon-webtools crate to wasm32-unknown-unknown and copy the
# artefact into the @snapdragon-ai/webtools npm package.
#
# Target rationale: webtools is pure-compute (no HTTP, no SQLite, no clock,
# no rand-from-OS) and is called in-process from Node via plain
# `WebAssembly.instantiate(buf)` — so we don't need WASI preview-2 or jco /
# preview2-shim plumbing, just the small custom ABI in
# `crates/webtools/src/abi.rs`. That keeps the npm-side loader tiny and
# avoids dragging WASI imports into Node startup.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  export PATH="$HOME/.cargo/bin:$PATH"
fi

# `rustup target add wasm32-unknown-unknown` is a no-op when already installed,
# but we don't run it here — leave that to the developer's environment to keep
# CI/local explicit. Surface a useful error if the target is missing.
if ! rustc --print target-list | grep -q '^wasm32-unknown-unknown$'; then
  echo "error: rustc does not know about wasm32-unknown-unknown — install it via 'rustup target add wasm32-unknown-unknown'" >&2
  exit 1
fi

cargo build -p snapdragon-webtools --target wasm32-unknown-unknown --release

TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
if [[ "$TARGET_DIR" != /* ]]; then
  TARGET_DIR="$ROOT/$TARGET_DIR"
fi
ARTIFACT="$TARGET_DIR/wasm32-unknown-unknown/release/snapdragon_webtools.wasm"
if [[ ! -f "$ARTIFACT" ]]; then
  echo "error: expected wasm artifact not found: $ARTIFACT" >&2
  exit 1
fi

mkdir -p "$ROOT/packages/webtools/dist"
PACKAGED_ARTIFACT="$ROOT/packages/webtools/dist/snapdragon_webtools.wasm"
PACKAGED_MANIFEST="$ROOT/packages/webtools/dist/snapdragon_webtools.manifest.json"
cp "$ARTIFACT" "$PACKAGED_ARTIFACT.tmp"
mv "$PACKAGED_ARTIFACT.tmp" "$PACKAGED_ARTIFACT"

if ! cmp -s "$ARTIFACT" "$PACKAGED_ARTIFACT"; then
  echo "error: packaged wasm artifact differs from cargo output" >&2
  exit 1
fi

node "$ROOT/scripts/write-build-manifest.mjs" \
  --root "$ROOT" \
  --artifact "$PACKAGED_ARTIFACT" \
  --output "$PACKAGED_MANIFEST" \
  --target wasm32-unknown-unknown \
  --source "$ROOT/Cargo.toml" \
  --source "$ROOT/Cargo.lock" \
  --source "$ROOT/rust-toolchain.toml" \
  --source "$ROOT/scripts/build-webtools-wasm.sh" \
  --source "$ROOT/scripts/write-build-manifest.mjs" \
  --source "$ROOT/crates/webtools/Cargo.toml" \
  --source "$ROOT/crates/webtools/src"

echo "built $ARTIFACT"
echo "packaged packages/webtools/dist/snapdragon_webtools.wasm"
echo "wrote packages/webtools/dist/snapdragon_webtools.manifest.json"
shasum -a 256 "$PACKAGED_ARTIFACT" "$PACKAGED_MANIFEST"
