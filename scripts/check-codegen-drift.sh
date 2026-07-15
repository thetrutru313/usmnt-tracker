#!/usr/bin/env bash
# check-codegen-drift.sh
#
# Verifies that the generated files in lib/api-zod and lib/api-client-react
# are in sync with the OpenAPI spec.  Run this in CI or locally before
# merging changes that touch lib/api-spec/openapi.yaml.
#
# Exit code 0  → generated output matches the spec (no drift)
# Exit code 1  → generated output is out of date; run `pnpm --filter
#                @workspace/api-spec run codegen` to fix.

set -euo pipefail

echo "=== Codegen drift check ==="
echo ""

echo "Running codegen..."
pnpm --filter @workspace/api-spec run codegen

echo ""
echo "Checking for uncommitted changes in generated directories..."

if git diff --exit-code lib/api-zod lib/api-client-react; then
  echo ""
  echo "✓ Generated files are in sync with the spec."
  exit 0
else
  echo ""
  echo "✗ Generated files have drifted from the spec."
  echo ""
  echo "  The files above were modified by running codegen."
  echo "  Commit the regenerated output, or run:"
  echo ""
  echo "    pnpm --filter @workspace/api-spec run codegen"
  echo ""
  echo "  and then commit the resulting changes."
  exit 1
fi
