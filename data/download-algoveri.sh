#!/usr/bin/env bash
# Download the AlgoVeri benchmark.
#
# 77 classical algorithms with aligned specs across Dafny, Verus, and Lean.
# Covers data structures (heaps, segment trees, red-black trees), sorting,
# graph algorithms (Bellman-Ford, Edmonds-Karp), DP/greedy, and math algorithms.
#
# Paper: https://arxiv.org/abs/2602.09464
#
# NOTE: As of Feb 2026, the AlgoVeri repo is not yet public.
# Update the URL below once it becomes available.
#
# Output: ../algoveri/ (sibling directory)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "../algoveri" ]; then
  echo "AlgoVeri benchmark already cloned at ../algoveri, skipping."
  echo "Delete it to re-download."
  exit 0
fi

# TODO: update URL once the repo is public
REPO_URL="https://github.com/haoyuzhao123/algoveri.git"

echo "Cloning AlgoVeri benchmark..."
echo "NOTE: This repo may not be public yet. See https://arxiv.org/abs/2602.09464"
git clone --depth 1 "$REPO_URL" ../algoveri

echo "Done. Dataset: ../algoveri/"
echo "  77 classical algorithms with Dafny/Verus/Lean specs"
