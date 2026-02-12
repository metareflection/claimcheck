# End-to-End Evaluation Pipeline

Automated evaluation of the claimcheck pipeline (flatten → translate → compare) using [promptfoo](https://promptfoo.dev/) with ground-truth annotations and LLM-as-judge grading.

## Quick Start

```bash
# Run eval against cached pipeline outputs (no pipeline API calls)
npm run eval:cached

# Run eval live (calls Anthropic API for pipeline + judge)
npm run eval

# View detailed results in browser
npm run eval:view
```

## What It Tests

Each of the 5 test projects (counter, kanban, colorwheel, canon, delegation-auth) is evaluated with two assertions:

### Coverage Correctness

Checks pipeline coverage output against hand-annotated ground truth in `eval/ground-truth/*.yaml`. Verifies:

- Every expected proved claim appears in `coverage.proved` (by claimId)
- Every expected missing requirement appears in `coverage.missing` (by text match)
- Every expected unexpected claim appears in `coverage.unexpected` (by claimId)
- No false positives in proved
- Proved and missing counts match expectations

Pass threshold: 80% of checks.

### Translation Quality

LLM-as-judge (Claude Sonnet) grades up to 15 sampled translations per project on four dimensions:

- **Fidelity** — Does the natural language capture the formal Dafny expression's meaning?
- **No leakage** — Is the translation free of Dafny syntax?
- **Self-contained** — Readable without seeing the source code?
- **Completeness** — All conditions in the formal expression captured?

Pass threshold: average score ≥ 0.7, no individual score below 0.5.

## File Structure

```
eval/
  promptfooconfig.yaml              # Main config (test cases + assertions)
  providers/
    claimcheck-pipeline.mjs         # Custom provider: flatten → translate → compare
  assertions/
    coverage-correctness.mjs        # Ground truth matching
    translation-quality.mjs         # LLM-as-judge grading
  ground-truth/
    counter.yaml                    # Expected classifications per project
    kanban.yaml
    colorwheel.yaml
    canon.yaml
    delegation-auth.yaml
  cache/                            # Cached pipeline outputs for offline mode
    {project}-translated.json
    {project}-coverage.json
  prompts/
    pipeline-input.txt              # Promptfoo template (required by framework)
  seed-cache.mjs                    # Script to regenerate cache
```

## Modes

| Mode | Command | Pipeline API calls | Judge API calls |
|------|---------|-------------------|-----------------|
| Cached | `npm run eval:cached` | No (reads from `eval/cache/`) | Yes |
| Live | `npm run eval` | Yes (Haiku + Sonnet) | Yes |
| Write-cache | `CLAIMCHECK_EVAL_WRITE_CACHE=1 npm run eval` | Yes | Yes (also saves to cache) |

## Regenerating the Cache

When claims, requirements, or prompts change, regenerate cached outputs:

```bash
# All projects
node eval/seed-cache.mjs

# Single project
node eval/seed-cache.mjs counter
```

This runs the live pipeline and saves translated + coverage JSON to `eval/cache/`.

## Updating Ground Truth

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

## A/B Testing Models

Override translate or compare models in `eval/promptfooconfig.yaml`:

```yaml
providers:
  - id: file://providers/claimcheck-pipeline.mjs
    config:
      translateModel: claude-haiku-4-5-20251001
      compareModel: claude-sonnet-4-5-20250929
```

Run eval and compare scores to see the effect of model changes.
