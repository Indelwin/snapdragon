#!/usr/bin/env bash
set -euo pipefail

if ! command -v cargo-mutants >/dev/null 2>&1; then
  echo "cargo-mutants is not installed. Install with: cargo install cargo-mutants"
  exit 2
fi

cargo mutants \
  --package snapdragon-core \
  --file crates/core/src/bundle.rs \
  --exclude-re 'replace \| with \^.*base32_lower_no_pad' \
  --exclude-re 'replace > with >=.*base32_lower_no_pad' \
  --no-shuffle \
  --timeout 60
