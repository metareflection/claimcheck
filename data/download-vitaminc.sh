#!/usr/bin/env bash
# Download the VitaminC dataset (validation split) and convert to JSONL.
#
# Output: data/vitaminc/val.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="vitaminc"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/val.jsonl" ]; then
  echo "data/vitaminc/val.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

echo "Downloading VitaminC validation split..."

python3 -c "
import json, sys

try:
    from datasets import load_dataset
except ImportError:
    print('Install datasets: pip install datasets', file=sys.stderr)
    sys.exit(1)

print('Loading VitaminC validation split...', file=sys.stderr)
ds = load_dataset('tals/vitaminc', split='validation', trust_remote_code=True)

out_path = '$OUT_DIR/val.jsonl'
written = 0

with open(out_path, 'w') as f:
    for row in ds:
        label = row['label']
        # Normalize label
        if label == 'SUPPORTS':
            label = 'SUPPORTS'
        elif label == 'REFUTES':
            label = 'REFUTES'
        elif label in ('NOT ENOUGH INFO', 'NOT_ENOUGH_INFO'):
            label = 'NOT_ENOUGH_INFO'
        else:
            label = label.upper().replace(' ', '_')

        entry = {
            'id': row.get('unique_id', written),
            'claim': row['claim'],
            'evidence': row['evidence'],
            'label': label,
            'page': row.get('page', ''),
        }
        f.write(json.dumps(entry) + '\n')
        written += 1

print(f'Wrote {written} entries to {out_path}', file=sys.stderr)
"

echo "Done. Output: data/vitaminc/val.jsonl"
