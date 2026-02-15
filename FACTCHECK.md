# Fact-Checking Benchmarks

Evaluating the two-pass claim verification pipeline across multiple domains.

## Why two-pass?

When a model sees both the claim and evidence simultaneously, it anchors on the claim and reads the evidence through that lens — confirmation bias. The two-pass approach prevents this:

1. **Pass 1 (Summarize):** Model reads the evidence *without seeing the claim* and produces a neutral summary of what the evidence establishes.
2. **Pass 2 (Compare):** Model compares the summary to the claim and issues a verdict.

By structurally separating summarization from comparison, the model can't selectively read the evidence to confirm or deny the claim. We benchmark this against two controls:

- **Baseline:** Model sees claim + evidence together, judges directly (one call).
- **Single-prompt:** Model sees both but is *instructed* to summarize first (one call). Tests whether prompting alone prevents anchoring, without structural enforcement.

## Benchmarks

| Dataset | Domain | Entries | Labels | Evidence source | Why |
|---------|--------|---------|--------|-----------------|-----|
| [SciFact](https://github.com/allenai/scifact) | Biomedical | 321 | SUPPORTS / REFUTES / NEI | Research paper abstracts | Scientific claim verification |
| [FEVER](https://fever.ai/) | General facts | 9,999 | SUPPORTS / REFUTES / NEI | Wikipedia sentences | Standard fact verification benchmark |
| [VitaminC](https://github.com/TalSchuster/VitaminC) | General facts | 63,054 | SUPPORTS / REFUTES / NEI | Wikipedia (contrastive pairs) | Minimal edits that flip labels stress-test anchoring |
| [HealthVer](https://github.com/sarrouti/HealthVer) | Health / COVID-19 | 3,740 | SUPPORTS / REFUTES / NEI | PubMed evidence sentences | Complementary to SciFact, different source |

## Setup

### Download datasets

```bash
bash data/download-fever.sh       # ~1.6GB Wikipedia pages + claims
bash data/download-vitaminc.sh    # ~10MB
bash data/download-healthver.sh   # ~6MB
```

SciFact data is expected at `data/scifact/data/` (download separately from the [SciFact repo](https://github.com/allenai/scifact)).

### Dependencies

```bash
npm install                        # @anthropic-ai/sdk
pip install datasets               # for VitaminC download only
```

## Running benchmarks

All benchmarks share the same CLI interface:

```bash
node eval/bench-<name>.js --mode <mode> --label <label> [options]
```

### Modes

| Mode | API calls | Description |
|------|-----------|-------------|
| `baseline` | 1 | Claim + evidence together |
| `single-prompt` | 1 | Prompted to summarize first, then judge |
| `two-pass` | 2 | Structural separation: summarize, then compare |

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--mode` | `baseline` | Run mode |
| `--label` | auto | Result file name |
| `--model` | `claude-sonnet-4-5-20250929` | Model to use |
| `--backend` | `api` | `api` (Anthropic API) or `cc` (Claude Code CLI) |
| `--limit N` | 0 (all) | Max entries to run |
| `--offset N` | 0 | Skip first N entries |
| `--sample N` | 500 (FEVER/VitaminC) | Random sample size |
| `--seed N` | 42 | Random seed for sampling |
| `--verbose` | off | Print prompts and API details |

### Examples

```bash
# Quick smoke test
node eval/bench-scifact.js --mode baseline --label test --limit 5

# Full SciFact comparison
node eval/bench-scifact.js --mode baseline --label scifact-baseline
node eval/bench-scifact.js --mode two-pass --label scifact-two-pass

# FEVER with default 500-entry sample
node eval/bench-fever.js --mode baseline --label fever-baseline
node eval/bench-fever.js --mode two-pass --label fever-two-pass

# VitaminC (contrastive — best test of anchoring)
node eval/bench-vitaminc.js --mode baseline --label vitaminc-baseline
node eval/bench-vitaminc.js --mode two-pass --label vitaminc-two-pass

# HealthVer (small enough to run full)
node eval/bench-healthver.js --mode baseline --label healthver-baseline
node eval/bench-healthver.js --mode two-pass --label healthver-two-pass

# Full FEVER (no sampling, ~10K entries)
node eval/bench-fever.js --mode baseline --label fever-full --sample 0
```

Results are saved to `eval/results/<label>.json`.

## Results

*Results will be added as benchmarks are run.*

| Dataset | Mode | Accuracy | SUPPORTS | REFUTES | NEI | N |
|---------|------|----------|----------|---------|-----|---|
| SciFact | baseline | | | | | 321 |
| SciFact | two-pass | | | | | 321 |
| FEVER | baseline | | | | | 500 |
| FEVER | two-pass | | | | | 500 |
| VitaminC | baseline | | | | | 500 |
| VitaminC | two-pass | | | | | 500 |
| HealthVer | baseline | | | | | 3,740 |
| HealthVer | two-pass | | | | | 3,740 |

## Architecture

```
eval/
  lib/
    bench-common.js    # Shared: arg parsing, tool schemas, verdict parsing,
                       # sampling, three-mode runner, result saving
  bench-scifact.js     # SciFact: data loading + scientific prompts
  bench-fever.js       # FEVER: data loading + general-knowledge prompts
  bench-vitaminc.js    # VitaminC: data loading + contrastive-aware prompts
  bench-healthver.js   # HealthVer: data loading + health/scientific prompts

data/
  download-fever.sh    # Downloads from fever.ai, joins evidence text
  download-vitaminc.sh # Downloads from HuggingFace
  download-healthver.sh # Downloads from GitHub (sarrouti/HealthVer)
  scifact/data/        # SciFact corpus + claims
  fever/dev.jsonl       # FEVER claims with joined evidence
  vitaminc/val.jsonl    # VitaminC validation split
  healthver/dev.jsonl   # HealthVer dev+test entries
```

Each benchmark file is ~100-200 lines — just data loading and domain-specific prompt templates. All execution logic lives in `bench-common.js`.
