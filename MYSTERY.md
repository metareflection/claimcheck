# Mystery QA Benchmark

Two-pass claim verification applied to BIG-bench Minute Mysteries QA. Tests whether forcing the model to analyze a mystery story *before* seeing answer choices (preventing anchoring bias) improves accuracy.

See [factcheck-prompt.md](factcheck-prompt.md) for the design rationale.

## Dataset

203 multiple-choice mystery stories from BIG-bench. Each story ends with a question (e.g., "Who stole the wallet?") and has 3-5 answer choices with exactly one correct answer.

Source: `../BIG-bench/bigbench/benchmark_tasks/minute_mysteries_qa/multiplechoice/task.json`

## Modes

- **baseline**: Model sees story + question + choices all at once (single call)
- **two-pass**: Pass 1 analyzes the story without choices, Pass 2 selects from choices (two calls)

## Backends

- **api** (default): Direct Anthropic API calls. Structured output via `tool_use` (no parsing needed). Fast.
- **cc**: Claude Code CLI (`claude -p`). Text output parsed with regex. Slower.

## Usage

```bash
# API backend (default) — baseline vs two-pass
node eval/bench-mystery.js --mode baseline --label mystery-baseline --limit 5
node eval/bench-mystery.js --mode two-pass --label mystery-two-pass --limit 5

# Claude Code backend
node eval/bench-mystery.js --mode baseline --backend cc --label mystery-cc --limit 5

# Full run (all 203 examples)
node eval/bench-mystery.js --mode baseline --label mystery-baseline
node eval/bench-mystery.js --mode two-pass --label mystery-two-pass

# Use Opus
node eval/bench-mystery.js --mode baseline --model claude-opus-4-6 --label mystery-opus

# Run a slice (skip 10, take 5)
node eval/bench-mystery.js --mode baseline --offset 10 --limit 5 --label test-slice

# Compare results
node eval/compare-mystery.js mystery-baseline mystery-two-pass
```

## Options

| Flag | Description |
|------|-------------|
| `--mode <baseline\|two-pass>` | Evaluation mode (default: baseline) |
| `--backend <api\|cc>` | Backend: api (Anthropic API) or cc (Claude Code CLI) (default: api) |
| `--model <id>` | Model ID (default: claude-sonnet-4-5-20250929) |
| `--label <name>` | Label for result file |
| `--limit <n>` | Only run first n examples (default: all 203) |
| `--offset <n>` | Skip first n examples (default: 0) |
| `--verbose` | Print model output for each example |

Results are saved to `eval/results/<label>.json`.
