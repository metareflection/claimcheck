# Mystery QA Benchmark

Two-pass claim verification applied to BIG-bench Minute Mysteries QA. Tests whether forcing the model to analyze a mystery story *before* seeing answer choices (preventing anchoring bias) improves accuracy.

See [factcheck-prompt.md](factcheck-prompt.md) for the design rationale.

## Dataset

203 multiple-choice mystery stories from BIG-bench. Each story ends with a question (e.g., "Who stole the wallet?") and has 3-5 answer choices with exactly one correct answer.

Source: [BIG-bench Minute Mysteries QA](https://github.com/google/BIG-bench/tree/main/bigbench/benchmark_tasks/minute_mysteries_qa). Requires [BIG-bench](https://github.com/google/BIG-bench) cloned as a sibling directory (`../BIG-bench/`).

## Modes

- **baseline**: Model sees story + question + choices, answers directly (one call)
- **single-prompt**: Model sees everything, but the prompt instructs it to analyze first then choose (one call). Tests whether prompt instructions alone help vs structural separation.
- **two-pass**: Pass 1 analyzes the story without seeing choices, Pass 2 selects from choices given the analysis (two calls)

## Backends

- **api** (default): Direct Anthropic API calls. Structured output via `tool_use` (no parsing needed). Fast.
- **cc**: Claude Code CLI (`claude -p`). Text output parsed with regex. Slower.

## Usage

```bash
# API backend (default) — all three modes
node eval/bench-mystery.js --mode baseline --label mystery-baseline --limit 5
node eval/bench-mystery.js --mode single-prompt --label mystery-single --limit 5
node eval/bench-mystery.js --mode two-pass --label mystery-two-pass --limit 5

# Claude Code backend
node eval/bench-mystery.js --mode baseline --backend cc --label mystery-cc --limit 5

# Full run (all 203 examples)
node eval/bench-mystery.js --mode baseline --label mystery-baseline
node eval/bench-mystery.js --mode single-prompt --label mystery-single
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
| `--mode <baseline\|single-prompt\|two-pass>` | Evaluation mode (default: baseline) |
| `--backend <api\|cc>` | Backend: api (Anthropic API) or cc (Claude Code CLI) (default: api) |
| `--model <id>` | Model ID (default: claude-sonnet-4-5-20250929) |
| `--label <name>` | Label for result file |
| `--limit <n>` | Only run first n examples (default: all 203) |
| `--offset <n>` | Skip first n examples (default: 0) |
| `--verbose` | Print model output for each example |

Results are saved to `eval/results/<label>.json`.
