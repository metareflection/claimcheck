#!/usr/bin/env bash
# Download the AVeriTeC dataset and convert to JSONL.
#
# Downloads from the AVeriTeC GitHub repo.
# Real-world claims with Q&A evidence pairs from the web.
#
# Labels: Supported, Refuted, Not Enough Evidence,
#         Conflicting Evidence/Cherry-picking
#
# Output: data/averitec/dev.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="averitec"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/dev.jsonl" ]; then
  echo "data/averitec/dev.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

# Download dev and train splits
for split in dev train; do
  if [ ! -f "$OUT_DIR/${split}.json" ]; then
    echo "Downloading AVeriTeC ${split}.json..."
    curl -L -o "$OUT_DIR/${split}.json" \
      "https://raw.githubusercontent.com/MichSchli/AVeriTeC/main/data/${split}.json"
  fi
done

echo "Converting to JSONL..."

python3 -c "
import json, sys, os

out_dir = '$OUT_DIR'

# Normalize labels to our format
label_map = {
    'Supported': 'SUPPORTS',
    'Refuted': 'REFUTES',
    'Not Enough Evidence': 'NOT_ENOUGH_INFO',
    'Conflicting Evidence/Cherry-picking': 'CONFLICTING',
}

all_entries = []

for split in ['dev']:
    path = os.path.join(out_dir, f'{split}.json')
    if not os.path.exists(path):
        print(f'Warning: {path} not found, skipping', file=sys.stderr)
        continue

    with open(path) as f:
        data = json.load(f)

    print(f'{split}: {len(data)} claims', file=sys.stderr)

    for i, row in enumerate(data):
        label_raw = row.get('label', '')
        label = label_map.get(label_raw, label_raw.upper().replace(' ', '_'))

        # Extract evidence from Q&A pairs
        evidence_sentences = []
        questions = row.get('questions', [])
        for q in questions:
            for ans in q.get('answers', []):
                text = ans.get('answer', '').strip()
                if text and ans.get('answer_type') != 'Unanswerable':
                    evidence_sentences.append(text)

        entry = {
            'id': i,
            'claim': row.get('claim', ''),
            'label': label,
            'evidence_sentences': evidence_sentences,
            'justification': row.get('justification', ''),
        }
        all_entries.append(entry)

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

echo "Done. Output: data/averitec/dev.jsonl"
