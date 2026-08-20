#!/usr/bin/env bash
# Concatenate Sub2API Tools userscript modules into dist/sub2api-tools.user.js
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/dist/sub2api-tools.user.js"
mkdir -p "$ROOT/dist"

FILES=(
  "src/meta.header.js"
  "src/bootstrap.js"
  "src/core/util.js"
  "src/core/storage.js"
  "src/core/auth.js"
  "src/core/api.js"
  "src/core/dom-accounts.js"
  "src/core/registry.js"
  "src/core/ui-shell.js"
  "src/tools/grok-quota/export.js"
  "src/tools/grok-quota/probe.js"
  "src/tools/grok-quota/panel.js"
  "src/tools/grok-quota/index.js"
  "src/tools/grok-degrade/export.js"
  "src/tools/grok-degrade/probe.js"
  "src/tools/grok-degrade/panel.js"
  "src/tools/grok-degrade/index.js"
  "src/tools/delete-error-accounts/runner.js"
  "src/tools/delete-error-accounts/panel.js"
  "src/tools/delete-error-accounts/index.js"
  "src/tools/disable-accounts/runner.js"
  "src/tools/disable-accounts/panel.js"
  "src/tools/disable-accounts/index.js"
  "src/tools/register-all.js"
  "src/main.js"
)

missing=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "ERROR: missing $f" >&2
    missing=1
  fi
done
if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

{
  first=1
  for f in "${FILES[@]}"; do
    if [[ "$first" -eq 1 ]]; then
      # UserScript header must be the first bytes of the file (no leading comment)
      cat "$ROOT/$f"
      first=0
    else
      echo ""
      echo "/* ==== $f ==== */"
      cat "$ROOT/$f"
      echo ""
    fi
  done
} > "$OUT"

# Basic sanity checks
if ! head -n 1 "$OUT" | grep -q '==UserScript=='; then
  echo "ERROR: output must start with // ==UserScript==" >&2
  head -n 5 "$OUT" >&2
  exit 1
fi
if ! grep -q 'Grok 批量额度探测' "$OUT"; then
  echo "ERROR: output missing grok tool registration" >&2
  exit 1
fi
if ! grep -q 'Grok 批量降智检测' "$OUT"; then
  echo "ERROR: output missing grok-degrade tool" >&2
  exit 1
fi
if ! grep -q '批量删除错误账号' "$OUT"; then
  echo "ERROR: output missing delete-error-accounts tool" >&2
  exit 1
fi
if ! grep -q '批量删除停用账号' "$OUT"; then
  echo "ERROR: output missing disable-accounts tool" >&2
  exit 1
fi
if ! grep -q 'Sub2API 工具' "$OUT"; then
  echo "ERROR: output missing shell FAB label" >&2
  exit 1
fi

BYTES=$(wc -c < "$OUT" | tr -d ' ')
LINES=$(wc -l < "$OUT" | tr -d ' ')
echo "Built $OUT ($LINES lines, $BYTES bytes)"
