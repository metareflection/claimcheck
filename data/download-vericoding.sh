#!/usr/bin/env bash
# Download the VeriCoding benchmark.
#
# Clones from GitHub: https://github.com/Beneficial-AI-Foundation/vericoding-benchmark
# 12,504 formal specifications (3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean).
# 1,777 Dafny tasks have NL descriptions.
#
# Output: ../vericoding-benchmark/ (sibling directory)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "../vericoding-benchmark/specs" ]; then
  echo "VeriCoding benchmark already cloned at ../vericoding-benchmark, skipping."
  echo "Delete it to re-download."
  exit 0
fi

echo "Cloning VeriCoding benchmark..."
git clone --depth 1 https://github.com/Beneficial-AI-Foundation/vericoding-benchmark.git ../vericoding-benchmark

echo "Done. Dataset: ../vericoding-benchmark/jsonl/dafny_tasks.jsonl"
echo "  2,334 Dafny tasks (1,777 with NL descriptions)"
