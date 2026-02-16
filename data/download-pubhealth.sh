#!/usr/bin/env bash
# Download the PubHealth dataset and convert to JSONL.
#
# Downloads from Google Drive (original source).
# Public health claims with journalist-written explanations.
# Labels: true, false, unproven, mixture
#
# Output: data/pubhealth/dev.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="pubhealth"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/dev.jsonl" ]; then
  echo "data/pubhealth/dev.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

# Download zip from Google Drive
if [ ! -f "$OUT_DIR/PUBHEALTH.zip" ]; then
  echo "Downloading PUBHEALTH.zip from Google Drive..."
  curl -L -o "$OUT_DIR/PUBHEALTH.zip" \
    "https://drive.google.com/uc?export=download&id=1eTtRs5cUlBP5dXsx-FTAlmXuB6JQi2qj"
fi

echo "Extracting..."
unzip -qo "$OUT_DIR/PUBHEALTH.zip" -d "$OUT_DIR/"
rm "$OUT_DIR/PUBHEALTH.zip"

echo "Converting to JSONL..."

python3 -c "
import csv, json, sys, os, glob

out_dir = '$OUT_DIR'

label_map = {
    'true': 'SUPPORTS',
    'false': 'REFUTES',
    'unproven': 'NOT_ENOUGH_INFO',
    'mixture': 'MIXTURE',
}

# Find the TSV files (may be in a subdirectory)
tsv_files = glob.glob(os.path.join(out_dir, '**/*.tsv'), recursive=True)
print(f'Found TSV files: {tsv_files}', file=sys.stderr)

all_entries = []
entry_id = 0

for path in sorted(tsv_files):
    basename = os.path.basename(path)
    # Only use dev and test splits
    if not any(s in basename for s in ['dev', 'test']):
        continue

    print(f'Processing {path}...', file=sys.stderr)

    with open(path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        print(f'  Columns: {reader.fieldnames}', file=sys.stderr)

        for row in reader:
            label_raw = (row.get('label') or '').strip().lower()
            label = label_map.get(label_raw, label_raw.upper().replace(' ', '_'))

            claim = (row.get('claim') or '').strip()
            explanation = (row.get('explanation') or '').strip()

            if not claim:
                continue

            entry = {
                'id': entry_id,
                'claim': claim,
                'label': label,
                'evidence_sentences': [explanation] if explanation else [],
            }
            all_entries.append(entry)
            entry_id += 1

out_path = os.path.join(out_dir, 'dev.jsonl')
with open(out_path, 'w') as f:
    for entry in all_entries:
        f.write(json.dumps(entry) + '\n')

print(f'Wrote {len(all_entries)} entries to {out_path}', file=sys.stderr)

from collections import Counter
dist = Counter(e['label'] for e in all_entries)
for label, count in sorted(dist.items()):
    print(f'  {label}: {count}', file=sys.stderr)
"

echo "Done. Output: data/pubhealth/dev.jsonl"
