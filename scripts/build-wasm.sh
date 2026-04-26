#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -x "$HOME/.cargo/bin/cargo" ]]; then
  PATH="$HOME/.cargo/bin:$PATH" cargo build -p snapdragon-core --target wasm32-wasip2 --release
else
  cargo build -p snapdragon-core --target wasm32-wasip2 --release
fi

ARTIFACT="$ROOT/target/wasm32-wasip2/release/snapdragon_core.wasm"
if [[ ! -f "$ARTIFACT" ]]; then
  echo "error: expected wasm artifact not found: $ARTIFACT" >&2
  exit 1
fi

mkdir -p "$ROOT/packages/core/dist"
cp "$ARTIFACT" "$ROOT/packages/core/dist/snapdragon_core.wasm"

echo "built $ARTIFACT"
echo "copied packages/core/dist/snapdragon_core.wasm"
