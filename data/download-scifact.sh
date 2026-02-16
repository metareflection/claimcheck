#!/usr/bin/env bash
# Download the SciFact dataset.
#
# Downloads from the AllenAI S3 bucket:
#   https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz
#
# Output: data/scifact/data/{corpus.jsonl, claims_dev.jsonl, ...}

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="scifact"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/data/corpus.jsonl" ]; then
  echo "data/scifact/data/corpus.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

echo "Downloading SciFact dataset..."
curl -L -o "$OUT_DIR/data.tar.gz" \
  "https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz"

echo "Extracting..."
tar -xzf "$OUT_DIR/data.tar.gz" -C "$OUT_DIR/"
rm "$OUT_DIR/data.tar.gz"

echo "Done. Output: data/scifact/data/"
ls "$OUT_DIR/data/"
