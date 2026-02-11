#!/bin/bash
# Run the full integration suite.
#
# Usage:
#   ./test/integration/run-suite.sh              # extract + flatten (no API key needed)
#   ./test/integration/run-suite.sh --full        # also run claimcheck pipeline (needs ANTHROPIC_API_KEY + dafny)
#   ./test/integration/run-suite.sh --full counter # full pipeline on one project

set -e
cd "$(dirname "$0")/../.."

echo "=== Step 1: Extract claims from all dafny-replay projects ==="
echo ""
node test/integration/extract-all.js --save 2>&1
echo ""

echo "=== Step 2: Flatten claims (what claimcheck sees after module filtering) ==="
echo ""
node test/integration/flatten-all.js 2>&1
echo ""

if [ "$1" = "--full" ]; then
  echo "=== Step 3: Run claimcheck pipeline ==="
  echo ""
  shift
  node test/integration/run-all.js "$@" 2>&1
fi
