#!/usr/bin/env bash
# Download the HealthVer dataset from the original GitHub repo.
#
# Downloads CSV files from https://github.com/sarrouti/HealthVer
# and converts to JSONL.
#
# Output: data/healthver/dev.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="healthver"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/dev.jsonl" ]; then
  echo "data/healthver/dev.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

# Download CSV files from the original repo
echo "Downloading HealthVer CSV files..."
for split in train dev test; do
  if [ ! -f "$OUT_DIR/healthver_${split}.csv" ]; then
    curl -L -o "$OUT_DIR/healthver_${split}.csv" \
      "https://raw.githubusercontent.com/sarrouti/HealthVer/master/data/healthver_${split}.csv"
  fi
done

echo "Converting to JSONL..."

python3 -c "
import csv, json, sys, os

out_dir = '$OUT_DIR'

# Process dev and test splits (we use both for evaluation)
all_entries = []
entry_id = 0

for split in ['dev', 'test']:
    path = os.path.join(out_dir, f'healthver_{split}.csv')
    if not os.path.exists(path):
        print(f'Warning: {path} not found, skipping', file=sys.stderr)
        continue

    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        print(f'Columns in {split}: {reader.fieldnames}', file=sys.stderr)

        for row in reader:
            # Normalize label
            label_raw = row.get('label', row.get('verdict', '')).strip()
            if label_raw.lower() in ('support', 'supports'):
                label = 'SUPPORTS'
            elif label_raw.lower() in ('refute', 'refutes'):
                label = 'REFUTES'
            elif label_raw.lower() in ('neutral', 'not enough info', 'nei'):
                label = 'NOT_ENOUGH_INFO'
            else:
                label = label_raw.upper().replace(' ', '_')

            # Extract claim and evidence
            claim = row.get('claim', '').strip()
            evidence = row.get('evidence', '').strip()

            if not claim:
                continue

            entry = {
                'id': entry_id,
                'claim': claim,
                'evidence_sentences': [evidence] if evidence else [],
                'label': label,
            }
            all_entries.append(entry)
            entry_id += 1

# Write JSONL
out_path = os.path.join(out_dir, 'dev.jsonl')
with open(out_path, 'w') as f:
    for entry in all_entries:
        f.write(json.dumps(entry) + '\n')

print(f'Wrote {len(all_entries)} entries to {out_path}', file=sys.stderr)

# Label distribution
from collections import Counter
dist = Counter(e['label'] for e in all_entries)
for label, count in sorted(dist.items()):
    print(f'  {label}: {count}', file=sys.stderr)
"

echo "Done. Output: data/healthver/dev.jsonl"
