#!/usr/bin/env bash
set -euo pipefail

SEARCH_TARGETS=("packages/sdk-ts/src" "frontend" "src" "test")
LEGACY_PATTERNS=(
  "window\\.cofhe"
  "window\\.fhenix"
  "decryptValue\\("
  "cofhejs\\."
)

for pattern in "${LEGACY_PATTERNS[@]}"; do
  if rg -n "$pattern" "${SEARCH_TARGETS[@]}" >/dev/null 2>&1; then
    echo "Legacy cofhe code-path references found for pattern: $pattern"
    rg -n "$pattern" "${SEARCH_TARGETS[@]}"
    exit 1
  fi
done

echo "No legacy cofhe code-path references found."
