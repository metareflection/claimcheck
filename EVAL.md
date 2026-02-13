# Evaluation

Benchmark harness for measuring claimcheck accuracy across configurations.

## Quick Start

```bash
# Run 3 times with default settings (sonnet, no erase)
node eval/bench.js --runs 3 --label sonnet

# Compare two configs
node eval/compare.js sonnet opus
```

## Bench

```bash
node eval/bench.js --runs <N> --label <name> [options]
```

| Flag | Description |
|------|-------------|
| `--runs <N>` | Number of runs (default: 3) |
| `--label <name>` | Label for this result set (used as filename) |
| `--erase` | Also erase lemma bodies for Phase 2 proofs (Phase 1 always uses erased source) |
| `--model <id>` | Override LLM model (default: `claude-sonnet-4-5-20250929`) |
| `--verbose` | Verbose logging |

Results are saved to `eval/results/<label>.json`.

## Compare

```bash
node eval/compare.js <label-a> <label-b>
```

Shows per-requirement pass rates side by side with regression indicators.

## Example Configurations

```bash
# Sonnet baseline
node eval/bench.js --runs 3 --label sonnet

# Sonnet with erasure
node eval/bench.js --runs 3 --label sonnet-erase --erase

# Opus
node eval/bench.js --runs 3 --label opus --model claude-opus-4-6

# Opus with erasure
node eval/bench.js --runs 3 --label opus-erase --model claude-opus-4-6 --erase
```

## Reading Results

```
                                                  sonnet        opus
---------------------------------------------------------------------------

  counter
    The counter value is always non-negative        3/3           3/3
    The counter never exceeds 100                   0/3           0/3
  kanban
    Every card appears in exactly one column...     1/3           3/3  ↑
    ...

  Total                                             72/90         81/90
```

- `3/3` = proved in all 3 runs (consistent)
- `1/3` = proved once (flaky — LLM variance)
- `0/3` = never proved (hard or impossible)
- `↑` / `↓` = improvement / regression vs the other config

3 runs is enough to separate consistent from flaky. Use 5 for more confidence.

## What It Tests

Runs all 5 domains (30 total requirements):

| Domain | Requirements | Notes |
|--------|-------------|-------|
| counter | 5 | Simple. 4 provable, 1 correct gap (unbounded). |
| kanban | 8 | Medium. WIP limits, partitions, allocators. |
| colorwheel | 6 | Hard. Mood constraints, harmony patterns. |
| canon | 5 | Medium. Graph constraints, allocators. |
| delegation-auth | 6 | Medium. Auth properties, no-op behaviors. |

## Strategies in Results

The two-phase pipeline reports these strategies:

| Strategy | Meaning |
|----------|---------|
| `direct` | Phase 1 — verified with empty body (no proof needed) |
| `proof` | Phase 2 — LLM wrote a proof body |
| `proof-retry` | Phase 2 — LLM fixed a failed proof on retry |
| `formalize` / `resolve-retry` | Phase 1 resolution failures (appear in obligations) |

## Cost

Each run costs ~$0.50-1.00 with Sonnet, ~$5-10 with Opus. A 3-run eval with Sonnet is ~$2-3.
The two-phase pipeline reduces LLM calls: Phase 1 batches all requirements in one call. Phase 2 only runs for lemmas that need proofs.

Token counts in `run-all.js` output are cumulative (module-level counter doesn't reset between domains) — the last domain's number is the total. The bench script doesn't have this issue since each domain runs as a separate process.
