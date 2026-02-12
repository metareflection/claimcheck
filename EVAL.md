# Evaluation

End-to-end evaluation of the claimcheck pipeline (flatten → translate → compare) using [promptfoo](https://promptfoo.dev/). Compares model combinations on quality (coverage correctness, translation quality) and performance (latency, token usage).

## Quick start

```bash
cd eval

# Run the opus model comparison
npx promptfoo eval -c promptfoo-opus.yaml

# Print comparison table
node compare-results.mjs results/opus-latest.json
```

## Eval configs

| Config | Providers | Purpose |
|--------|-----------|---------|
| `promptfoo-opus.yaml` | haiku→sonnet, haiku→opus, sonnet→opus, opus→opus | Compare Opus as translate/compare model |
| `promptfoo-ab.yaml` | haiku→sonnet, sonnet→sonnet, haiku→haiku | A/B test model tiers |
| `promptfooconfig.yaml` | single provider (default models) | Baseline regression |

Provider labels use the format **translate→compare**, e.g. `haiku→opus` means Haiku translates formal claims to natural language, then Opus compares them against requirements.

## Assertions

Each test case runs three assertions:

### Coverage correctness

Checks pipeline coverage output against hand-annotated ground truth in `eval/ground-truth/*.yaml`. Verifies:

- Every expected proved claim appears in `coverage.proved` (by claimId)
- Every expected missing requirement appears in `coverage.missing` (by text match)
- Every expected unexpected claim appears in `coverage.unexpected` (by claimId)
- No false positives in proved
- Proved and missing counts match expectations

Pass threshold: 80% of checks.

### Translation quality

LLM-as-judge (Claude Sonnet) grades up to 15 sampled translations per project on four dimensions:

- **Fidelity** — Does the natural language capture the formal Dafny expression's meaning?
- **No leakage** — Is the translation free of Dafny syntax?
- **Self-contained** — Readable without seeing the source code?
- **Completeness** — All conditions in the formal expression captured?

Pass threshold: average score >= 0.7, no individual score below 0.5.

### Performance

Extracts timing and token usage from the pipeline output as `namedScores`. Always passes (reporting only, not gating). Metrics:

- `translateMs` — time spent in translate step
- `compareMs` — time spent in compare step
- `totalMs` — end-to-end pipeline time
- `inputTokens` — total input tokens consumed
- `outputTokens` — total output tokens consumed

These metrics are surfaced in the comparison table and promptfoo web UI.

## Comparison script

`compare-results.mjs` reads a promptfoo JSON output file and generates a markdown comparison table.

```bash
# From a specific results file
node compare-results.mjs results/opus-latest.json

# Custom output path
node compare-results.mjs results/opus-latest.json results/opus-comparison.md

# From latest eval in promptfoo's store (no args)
node compare-results.mjs
```

Output includes:

- **Summary table** — pass rate, coverage, translation quality, latency, and token usage across all providers, with the best value per row bolded
- **Per-test breakdown** — same metrics drilled down by project
- **Winners** — auto-picks the best provider for quality, speed, and cost

Output is printed to stdout and written to `results/comparison.md` (or custom path).

## File structure

```
eval/
├── promptfoo-opus.yaml          # eval config: opus comparisons
├── promptfoo-ab.yaml            # eval config: A/B model tiers
├── promptfooconfig.yaml         # eval config: default baseline
├── compare-results.mjs          # comparison table generator
├── seed-cache.mjs               # populate cache for offline runs
├── assertions/
│   ├── coverage-correctness.mjs # checks pipeline output vs ground truth
│   ├── translation-quality.mjs  # LLM-as-judge grading of translations
│   └── performance.mjs          # extracts timing + token metrics
├── providers/
│   └── claimcheck-pipeline.mjs  # custom provider: flatten → translate → compare
├── prompts/
│   └── pipeline-input.txt       # prompt template (project/module vars)
├── ground-truth/                # expected coverage per project
│   ├── counter.yaml
│   ├── kanban.yaml
│   ├── colorwheel.yaml
│   ├── canon.yaml
│   └── delegation-auth.yaml
├── cache/                       # cached pipeline outputs for offline runs
│   ├── {project}-translated.json
│   └── {project}-coverage.json
└── results/                     # eval output (gitignored)
    ├── opus-latest.json
    ├── ab-latest.json
    └── comparison.md
```

## Test projects

| Project | Module | Claims | Description |
|---------|--------|--------|-------------|
| counter | CounterDomain | 4 | Small domain, 5 requirements |
| kanban | KanbanDomain | ~16 | WIP limits and card tracking |
| colorwheel | ColorWheelDomain | ~23 | Color palette with mood/harmony constraints |
| canon | CanonDomain | ~21 | Graph layout with constraints and edges |
| delegation-auth | DelegationAuthDomain | ~11 | Capability-based auth with delegation chains |

## Modes

| Mode | Command | Pipeline API calls | Judge API calls |
|------|---------|-------------------|-----------------|
| Cached | `CLAIMCHECK_EVAL_CACHED=1 npx promptfoo eval -c promptfoo-opus.yaml` | No (reads from `eval/cache/`) | Yes |
| Live | `npx promptfoo eval -c promptfoo-opus.yaml` | Yes | Yes |
| Write-cache | `CLAIMCHECK_EVAL_WRITE_CACHE=1 npx promptfoo eval -c promptfoo-opus.yaml` | Yes | Yes (also saves to cache) |

## Regenerating the cache

When claims, requirements, or prompts change, regenerate cached outputs:

```bash
# All projects
node eval/seed-cache.mjs

# Single project
node eval/seed-cache.mjs counter
```

This runs the live pipeline and saves translated + coverage JSON to `eval/cache/`.

## Updating ground truth

After regenerating the cache, review the outputs and update `eval/ground-truth/*.yaml` if the expected classifications have changed. Each file has the format:

```yaml
project: counter
module: CounterDomain

proved:
  - requirementIndex: 1
    claimId: "pred:CounterDomain.Inv:0"

missing:
  - requirementIndex: 4
    requirementText: "Decrementing at zero"

unexpected:
  - claimId: "fn:CounterDomain.Apply:requires:0"
```

## A/B testing models

Add a provider entry to any eval config:

```yaml
providers:
  - id: file://providers/claimcheck-pipeline.mjs
    label: haiku→new-model
    config:
      translateModel: claude-haiku-4-5-20251001
      compareModel: new-model-id
```

Then run and compare:

```bash
npx promptfoo eval -c promptfoo-opus.yaml && node compare-results.mjs results/opus-latest.json
```

## Adding a new test project

1. Ensure claim JSON exists at `test/integration/claims/{project}.json`
2. Ensure requirements exist at `test/integration/reqs/{project}.md`
3. Create ground truth at `eval/ground-truth/{project}.yaml` (see existing files for format)
4. Add a test entry to each eval config yaml:

```yaml
  - description: "my-project"
    vars:
      projectName: my-project
      moduleName: MyProjectDomain
    assert:
      - type: javascript
        value: file://assertions/coverage-correctness.mjs
      - type: javascript
        value: file://assertions/translation-quality.mjs
      - type: javascript
        value: file://assertions/performance.mjs
```

## Viewing results

```bash
# Web UI
npx promptfoo view

# If port 15500 is in use
npx promptfoo view -p 15501

# CLI comparison table
node compare-results.mjs results/opus-latest.json
```
