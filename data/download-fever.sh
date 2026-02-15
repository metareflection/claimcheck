#!/usr/bin/env bash
# Download the FEVER dataset and join evidence text.
#
# Downloads from fever.ai:
# 1. paper_dev.jsonl (labelled dev claims)
# 2. wiki-pages.zip (Wikipedia sentences for evidence lookup)
#
# Then joins evidence text into each claim and writes JSONL.
#
# Output: data/fever/dev.jsonl

set -euo pipefail
cd "$(dirname "$0")"

OUT_DIR="fever"
mkdir -p "$OUT_DIR"

if [ -f "$OUT_DIR/dev.jsonl" ]; then
  echo "data/fever/dev.jsonl already exists, skipping download."
  echo "Delete it to re-download."
  exit 0
fi

# Download paper_dev.jsonl
if [ ! -f "$OUT_DIR/paper_dev.jsonl" ]; then
  echo "Downloading FEVER paper_dev.jsonl..."
  curl -L -o "$OUT_DIR/paper_dev.jsonl" "https://fever.ai/download/fever/paper_dev.jsonl"
fi

# Download and extract wiki pages
if [ ! -d "$OUT_DIR/wiki-pages" ]; then
  echo "Downloading Wikipedia pages (this is ~1.6GB, may take a while)..."
  curl -L -o "$OUT_DIR/wiki-pages.zip" "https://fever.ai/download/fever/wiki-pages.zip"
  echo "Extracting wiki pages..."
  unzip -q "$OUT_DIR/wiki-pages.zip" -d "$OUT_DIR/"
  rm "$OUT_DIR/wiki-pages.zip"
fi

echo "Processing: joining evidence text to claims..."

python3 -c "
import json, sys, os
from collections import defaultdict

out_dir = '$OUT_DIR'

# Load Wikipedia pages into a lookup: page_title -> {line_id: text}
print('Loading Wikipedia pages...', file=sys.stderr)
page_lines = {}
wiki_dir = os.path.join(out_dir, 'wiki-pages')

for fname in sorted(os.listdir(wiki_dir)):
    if not fname.endswith('.jsonl'):
        continue
    with open(os.path.join(wiki_dir, fname)) as f:
        for line in f:
            row = json.loads(line)
            title = row['id']
            if title not in page_lines:
                page_lines[title] = {}
            if row.get('lines'):
                for ln in row['lines'].split('\n'):
                    parts = ln.split('\t', 1)
                    if len(parts) == 2 and parts[0].isdigit():
                        page_lines[title][int(parts[0])] = parts[1]

print(f'Loaded {len(page_lines)} Wikipedia pages', file=sys.stderr)

# Load claims and group evidence
print('Loading claims...', file=sys.stderr)
claims = {}
evidence_by_claim = defaultdict(list)

with open(os.path.join(out_dir, 'paper_dev.jsonl')) as f:
    for line in f:
        row = json.loads(line)
        cid = row['id']
        if cid not in claims:
            claims[cid] = {
                'id': cid,
                'claim': row['claim'],
                'label': row['label'],
            }
        # Collect evidence (list of [annotation_id, evidence_id, page, sent_id])
        for ev_set in row.get('evidence', []):
            for ev in ev_set:
                page = ev[2]
                sent_id = ev[3]
                if page and sent_id is not None and sent_id >= 0:
                    evidence_by_claim[cid].append((page, sent_id))

# Join evidence text and write JSONL
out_path = os.path.join(out_dir, 'dev.jsonl')
written = 0

with open(out_path, 'w') as f:
    for cid, claim_data in claims.items():
        # Deduplicate evidence pairs
        ev_pairs = list(set(evidence_by_claim.get(cid, [])))
        evidence_sentences = []
        evidence_sources = []

        for page, sent_id in ev_pairs:
            lines = page_lines.get(page, {})
            text = lines.get(sent_id)
            if text:
                evidence_sentences.append(text)
                evidence_sources.append({'page': page, 'sentence_id': sent_id})

        label = claim_data['label']
        if label == 'NOT ENOUGH INFO':
            label = 'NOT_ENOUGH_INFO'

        entry = {
            'id': cid,
            'claim': claim_data['claim'],
            'label': label,
            'evidence_sentences': evidence_sentences,
            'evidence_sources': evidence_sources,
        }
        f.write(json.dumps(entry) + '\n')
        written += 1

print(f'Wrote {written} claims to {out_path}', file=sys.stderr)
"

echo "Done. Output: data/fever/dev.jsonl"
