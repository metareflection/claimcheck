#!/usr/bin/env bash
# Download the MuSR Murder Mystery dataset.
#
# Clones from GitHub: https://github.com/Zayne-sprague/MuSR
# 250 murder mystery stories, binary choice, ~5500 chars each.
#
# Output: ../MuSR/datasets/murder_mystery.json (sibling directory)

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -d "../MuSR/datasets" ]; then
  echo "MuSR already cloned at ../MuSR, skipping."
  echo "Delete it to re-download."
  exit 0
fi

echo "Cloning MuSR repository..."
git clone --depth 1 https://github.com/Zayne-sprague/MuSR.git ../MuSR

echo "Done. Dataset: ../MuSR/datasets/murder_mystery.json"
echo "  250 murder mystery stories (binary choice)"
