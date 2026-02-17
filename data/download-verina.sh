#!/usr/bin/env bash
# Download the VERINA benchmark.
#
# Clones from GitHub: https://github.com/sunblaze-ucb/verina
# 189 manually curated coding tasks with detailed NL descriptions,
# reference implementations, formal specifications, and test suites.
# Includes Dafny sources (49 from MBPP-DFY-50 + 59 from CloverBench)
# and Lean translations.
#
# Paper: https://arxiv.org/abs/2505.23135
# Output: ../verina/ (sibling directory)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "../verina" ]; then
  echo "VERINA benchmark already cloned at ../verina, skipping."
  echo "Delete it to re-download."
  exit 0
fi

echo "Cloning VERINA benchmark..."
git clone --depth 1 https://github.com/sunblaze-ucb/verina.git ../verina

echo "Done. Dataset: ../verina/"
echo "  189 tasks with NL descriptions + Dafny/Lean specs"
