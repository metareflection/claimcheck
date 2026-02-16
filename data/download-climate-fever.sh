#!/usr/bin/env bash
# Download the CLIMATE-FEVER dataset and convert to JSONL.
#
# Downloads from HuggingFace via the datasets library.
# Each claim has 5 evidence sentences from Wikipedia.
#
# Output: data/climate-fever/dev.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="climate-fever"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/dev.jsonl" ]; then
  echo "data/climate-fever/dev.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

echo "Downloading CLIMATE-FEVER dataset..."

python3 -c "
import json, sys

try:
    from datasets import load_dataset
except ImportError:
    print('Install datasets: pip install datasets', file=sys.stderr)
    sys.exit(1)

print('Loading CLIMATE-FEVER...', file=sys.stderr)
ds = load_dataset('tdiggelm/climate_fever', split='test')

out_path = '$OUT_DIR/dev.jsonl'
written = 0

# Claim-level labels: 0=SUPPORTS, 1=REFUTES, 2=NOT_ENOUGH_INFO, 3=DISPUTED
label_map = {0: 'SUPPORTS', 1: 'REFUTES', 2: 'NOT_ENOUGH_INFO', 3: 'DISPUTED'}
# Evidence-level labels: 0=SUPPORTS, 1=REFUTES, 2=NOT_ENOUGH_INFO
ev_label_map = {0: 'SUPPORTS', 1: 'REFUTES', 2: 'NOT_ENOUGH_INFO'}

with open(out_path, 'w') as f:
    for row in ds:
        claim_label = label_map.get(row['claim_label'], str(row['claim_label']))

        # Extract evidence sentences
        evidences = row.get('evidences', [])
        evidence_sentences = []
        evidence_sources = []
        for ev in evidences:
            text = ev.get('evidence', '').strip()
            if text:
                evidence_sentences.append(text)
                evidence_sources.append({
                    'article': ev.get('article', ''),
                    'evidence_label': ev_label_map.get(ev.get('evidence_label'), ''),
                })

        entry = {
            'id': row['claim_id'],
            'claim': row['claim'],
            'label': claim_label,
            'evidence_sentences': evidence_sentences,
            'evidence_sources': evidence_sources,
        }
        f.write(json.dumps(entry) + '\n')
        written += 1

print(f'Wrote {written} claims to {out_path}', file=sys.stderr)

from collections import Counter
labels = Counter()
for row in ds:
    labels[label_map.get(row['claim_label'], '?')] += 1
for label, count in sorted(labels.items()):
    print(f'  {label}: {count}', file=sys.stderr)
"

echo "Done. Output: data/climate-fever/dev.jsonl"
