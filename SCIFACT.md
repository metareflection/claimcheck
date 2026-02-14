# SciFact Benchmark

Two-pass claim verification applied to [SciFact](https://github.com/allenai/scifact) — scientific claim verification against research paper evidence. Tests whether summarizing evidence before seeing the claim (preventing anchoring bias) improves verdict accuracy.

## Dataset

300 expert-written biomedical claims from the SciFact dev set, paired with evidence sentences (rationales) from paper abstracts. Three-way classification:

- **SUPPORTS**: evidence supports the claim
- **REFUTES**: evidence contradicts the claim
- **NOT_ENOUGH_INFO**: evidence is insufficient to judge

321 evaluable entries (some claims have multiple evidence documents).

Data is downloaded from the [SciFact S3 bucket](https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz) to `data/scifact/data/`.

## Modes

- **baseline**: Model sees claim + evidence sentences, judges directly (one call)
- **single-prompt**: Model sees both, but prompted to summarize evidence first then compare (one call)
- **two-pass**: Model summarizes evidence without seeing claim (Pass 1), then compares summary to claim (Pass 2) — two calls

## Backends

- **api** (default): Direct Anthropic API with structured `tool_use` output
- **cc**: Claude Code CLI (`claude -p`)

## Usage

```bash
# Download dataset (one-time)
mkdir -p data/scifact && cd data/scifact
curl -sL https://scifact.s3-us-west-2.amazonaws.com/release/latest/data.tar.gz | tar xz

# Run all three modes on a subset
node eval/bench-scifact.js --mode baseline --label scifact-baseline --limit 10
node eval/bench-scifact.js --mode single-prompt --label scifact-single --limit 10
node eval/bench-scifact.js --mode two-pass --label scifact-two-pass --limit 10

# Full run (321 entries)
node eval/bench-scifact.js --mode baseline --label scifact-baseline
node eval/bench-scifact.js --mode single-prompt --label scifact-single
node eval/bench-scifact.js --mode two-pass --label scifact-two-pass

# Use Opus
node eval/bench-scifact.js --mode two-pass --model claude-opus-4-6 --label scifact-opus

# Compare (use compare-mystery.js — same result format)
node eval/compare-mystery.js scifact-baseline scifact-two-pass
```

## Options

| Flag | Description |
|------|-------------|
| `--mode <baseline\|single-prompt\|two-pass>` | Evaluation mode (default: baseline) |
| `--backend <api\|cc>` | Backend (default: api) |
| `--model <id>` | Model ID (default: claude-sonnet-4-5-20250929) |
| `--label <name>` | Label for result file |
| `--limit <n>` | Only run first n entries (default: all) |
| `--offset <n>` | Skip first n entries (default: 0) |
| `--verbose` | Print model output |

Results are saved to `eval/results/<label>.json` and include per-label accuracy (SUPPORTS/REFUTES/NOT_ENOUGH_INFO).
