# claimcheck

Does a Dafny lemma actually mean what a natural language requirement says? Dafny can verify proofs, but it can't verify meaning. Claimcheck fills that gap.

Someone else (Claude Code, a human, any agent) writes the lemmas and claims "requirement X is covered by lemma Y." Claimcheck verifies that claim via a round-trip: informalize the lemma back to English (without seeing the requirement), then compare.

## Modes

### Two-pass mode (default)

Structural separation — different models for informalization and comparison:

```
1. Extract mapped lemmas from claims .dfy file
2. Batch informalize all lemmas (haiku) — does NOT see requirements
3. Batch compare back-translations against requirements (sonnet)
4. Report: confirmed / disputed
```

### Single-prompt mode (`--single-prompt`)

Prompt-level separation — one model does both passes sequentially:

```
1. Extract mapped lemmas from claims .dfy file
2. For each mapping: single LLM call with two-pass prompt
   a. Pass 1: informalize the lemma (before seeing the NL requirement)
   b. Pass 2: compare, check vacuity, flag surprising restrictions
3. Report with richer verdicts: JUSTIFIED / PARTIALLY_JUSTIFIED / NOT_JUSTIFIED / VACUOUS
```

### Claude Code benchmark (`eval/bench-cc.js`)

Same single-prompt approach piped through `claude -p` — no structural or prompt-level separation (the model sees everything at once). Useful for comparing whether look-ahead matters.

## Usage

```bash
# Two-pass audit (default)
node bin/claimcheck.js \
  -r test/integration/reqs/counter.md \
  -m test/integration/mappings/counter.json \
  --dfy test/integration/claims/counter.dfy \
  --module CounterDomain -d counter

# Single-prompt audit
node bin/claimcheck.js \
  -r test/integration/reqs/counter.md \
  -m test/integration/mappings/counter.json \
  --dfy test/integration/claims/counter.dfy \
  --module CounterDomain -d counter --single-prompt --json

# All test projects
node test/integration/run-all.js

# Single test project
node test/integration/run-all.js counter
```

### Benchmarks

```bash
# Run benchmarks
node eval/bench.js --runs 3 --label two-pass
node eval/bench.js --runs 3 --label single-prompt --single-prompt
node eval/bench-cc.js --runs 1 --label cc-sonnet

# Run a single domain or lemma
node eval/bench-cc.js --runs 1 --label test --domain counter
node eval/bench-cc.js --runs 1 --label test --domain counter --lemma CounterNonNegative

# Compare results
node eval/compare.js two-pass single-prompt
node eval/compare.js two-pass cc-sonnet
```

## Options

| Flag | Description |
|------|-------------|
| `-r, --requirements <path>` | Path to requirements file (markdown) |
| `-m, --mapping <path>` | Path to mapping file (JSON) |
| `--dfy <path>` | Path to claims .dfy file (containing the lemmas) |
| `--module <name>` | Dafny module name to import |
| `-d, --domain <name>` | Human-readable domain name (default: module name) |
| `-o, --output <dir>` | Output directory for obligations.dfy (default: `.`) |
| `--json` | Output JSON instead of markdown |
| `--single-prompt` | Use single-prompt claimcheck mode (one call per pair) |
| `--model <id>` | Model for single-prompt mode (default: sonnet) |
| `--verify` | Also run dafny verify on each lemma |
| `--informalize-model <id>` | Model for back-translation in two-pass mode (default: haiku) |
| `--compare-model <id>` | Model for comparison in two-pass mode (default: sonnet) |
| `-v, --verbose` | Verbose API/verification logging |

## Output

For each mapping entry, one of:

| Status | Meaning |
|--------|---------|
| **confirmed** | Round-trip passed — lemma faithfully expresses the requirement |
| **disputed** | Round-trip failed — discrepancy between lemma meaning and requirement |
| **verify-failed** | Dafny verification failed (only with `--verify` flag) |
| **error** | Lemma not found in source |

In single-prompt mode, disputed results include richer detail: verdict category, vacuity analysis, and surprising restrictions.

## Test Projects

| Project | Domain file | Module |
|---------|------------|--------|
| counter | `counter/CounterDomain.dfy` | CounterDomain |
| kanban | `kanban/KanbanDomain.dfy` | KanbanDomain |
| colorwheel | `colorwheel/ColorWheelDomain.dfy` | ColorWheelDomain |
| canon | `canon/CanonDomain.dfy` | CanonDomain |
| delegation-auth | `delegation-auth/DelegationAuthDomain.dfy` | DelegationAuthDomain |

Requirements files live in `test/integration/reqs/`. Claims files in `test/integration/claims/`. Domain `.dfy` files are in `../dafny-replay/`.

## Benchmark Results

Accuracy across 5 domains (counter, kanban, colorwheel, canon, delegation-auth) with 36 requirement-lemma pairs, including 8 deliberately bogus lemmas (tautologies, weakened postconditions, narrowed scope):

| Variant | Accuracy | Time/run | API calls/run |
|---------|----------|----------|---------------|
| **Two-pass** (default) | 96.3% (104/108) | ~108s | 2 (batch informalize + batch compare) |
| **Single-prompt** | 86.1% (31/36) | ~353s | 36 (one per pair) |
| **Claude Code** (`bench-cc`) | 69.4% (25/36) | ~693s | 36 (one `claude -p` per pair) |

Two-pass had 3 runs; single-prompt and Claude Code had 1 run each.

Key takeaways:
- Structural separation (two-pass) is both the most accurate and fastest
- The informalize-without-seeing-requirement step prevents anchoring bias
- Batching into 2 API calls vs 36 individual calls gives a ~3x speed advantage
- Claude Code's general-purpose system prompt and lack of structured output hurt both accuracy and speed

## Requirements

- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable
- `dafny` in PATH (only for `--verify`)
