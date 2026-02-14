# Evaluation

Benchmark harness for measuring claimcheck accuracy across configurations.

## Quick Start

```bash
# API two-pass audit (default)
node eval/bench.js --runs 3 --label two-pass

# API single-prompt audit
node eval/bench.js --runs 3 --label single-prompt --single-prompt

# Claude Code benchmark (no structural separation)
node eval/bench-cc.js --runs 1 --label cc-sonnet

# Compare any two configs
node eval/compare.js two-pass single-prompt
node eval/compare.js single-prompt cc-sonnet
```

## bench.js — API Benchmark

Runs the audit pipeline (two-pass or single-prompt) via the Anthropic API.

```bash
node eval/bench.js --runs <N> --label <name> [options]
```

| Flag | Description |
|------|-------------|
| `--runs <N>` | Number of runs (default: 3) |
| `--label <name>` | Label for this result set (used as filename) |
| `--single-prompt` | Use single-prompt claimcheck mode |
| `--model <id>` | Override LLM model (default: sonnet) |
| `--erase` | Erase lemma bodies before audit |
| `--verbose` | Verbose logging |

Results are saved to `eval/results/<label>.json`.

## bench-cc.js — Claude Code Benchmark

Runs the claimcheck prompt via `claude -p` for each requirement-lemma pair. The model sees everything in one shot — no structural or prompt-level separation. Useful for measuring whether look-ahead at the NL requirement affects results.

```bash
node eval/bench-cc.js --runs <N> --label <name> [options]
```

| Flag | Description |
|------|-------------|
| `--runs <N>` | Number of runs (default: 1) |
| `--label <name>` | Label for this result set |
| `--model <id>` | Claude Code model (default: Claude Code's default) |
| `--verbose` | Show model output |

## compare.js — Compare Results

```bash
node eval/compare.js <label-a> <label-b>
```

Shows per-requirement pass rates side by side with regression indicators.

## Example Configurations

```bash
# Two-pass baseline (structural separation)
node eval/bench.js --runs 3 --label two-pass

# Single-prompt (prompt-level separation)
node eval/bench.js --runs 3 --label single-prompt --single-prompt

# Single-prompt with Opus
node eval/bench.js --runs 3 --label single-opus --single-prompt --model claude-opus-4-6

# Claude Code (no separation)
node eval/bench-cc.js --runs 1 --label cc-sonnet
```

## Reading Results

```
                                                  two-pass      single-prompt
---------------------------------------------------------------------------

  counter
    The counter value is always non-negative        3/3           3/3
    The initial state satisfies the invariant       3/3           3/3
  kanban
    Every card appears in exactly one column...     1/3           3/3  ↑
    ...

  Total                                             10/12         11/12
```

- `3/3` = confirmed in all 3 runs (consistent)
- `1/3` = confirmed once (flaky — LLM variance)
- `0/3` = never confirmed (disputed every time)
- `↑` / `↓` = improvement / regression vs the other config

3 runs is enough to separate consistent from flaky. Use 5 for more confidence.

## What It Tests

Runs all 5 domains across the mapped requirements:

| Domain | Requirements | Notes |
|--------|-------------|-------|
| counter | 5 (4 mapped) | Simple. Non-negativity, invariant preservation. |
| kanban | 8 | Medium. WIP limits, partitions, allocators. |
| colorwheel | 6 | Hard. Mood constraints, harmony patterns. |
| canon | 5 | Medium. Graph constraints, allocators. |
| delegation-auth | 6 | Medium. Auth properties, no-op behaviors. |

## Comparison Matrix

The key experimental question: does look-ahead at the NL requirement affect the audit?

| Config | Separation | Interface | Flag |
|--------|-----------|-----------|------|
| Two-pass (default) | Structural (different models) | API | `bench.js` |
| Single-prompt | Prompt-level ("do this BEFORE reading NL") | API | `bench.js --single-prompt` |
| Claude Code | None (model sees everything) | `claude -p` | `bench-cc.js` |

If single-prompt and Claude Code results match two-pass results, structural separation is unnecessary overhead. If they diverge, look-ahead matters.

## Cost

Each API run costs ~$0.50-1.00 with Sonnet. Claude Code runs use your Claude Code quota/billing.

Token counts in `run-all.js` output are cumulative (module-level counter doesn't reset between domains) — the last domain's number is the total. The bench script doesn't have this issue since each domain runs as a separate process.
