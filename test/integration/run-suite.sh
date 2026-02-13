#!/bin/bash
# Run the full integration suite.
#
# Usage:
#   ./test/integration/run-suite.sh                       # extract + flatten (no API key needed)
#   ./test/integration/run-suite.sh --full [project]      # legacy compare pipeline (needs ANTHROPIC_API_KEY + dafny)
#   ./test/integration/run-suite.sh --sentinel [project]  # new sentinel proof pipeline (needs ANTHROPIC_API_KEY + dafny)

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
  echo "=== Step 3: Run legacy compare pipeline ==="
  echo ""
  shift
  node test/integration/run-all.js "$@" 2>&1
elif [ "$1" = "--sentinel" ]; then
  echo "=== Step 3: Run sentinel proof pipeline ==="
  echo ""
  shift
  node test/integration/run-all-sentinel.js "$@" 2>&1
fi
