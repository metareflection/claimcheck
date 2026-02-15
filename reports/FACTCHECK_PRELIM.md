# Fact-Checking Benchmarks: Preliminary Results

Model: `claude-sonnet-4-5-20250929` | Temperature: 0 | Date: 2026-02-14

## Summary

| Dataset | Baseline | Two-Pass | Delta | N |
|---------|----------|----------|-------|---|
| SciFact (Sonnet) | **79.8%** | — | — | 321 |
| SciFact (Opus) | **83.5%** | — | — | 321 |
| FEVER | **95.6%** | 82.8% | **-12.8** | 500 |
| VitaminC | **83.8%** | 78.6% | **-5.2** | 500 |
| HealthVer | running... | — | — | 3,740 |

Two-pass is worse than baseline on both FEVER and VitaminC. The summarization step loses critical details.

## Per-Label Breakdown

### FEVER (N=500, sample seed=42)

| Label | Baseline | Two-Pass | Delta |
|-------|----------|----------|-------|
| SUPPORTS | 157/172 (91.3%) | 105/172 (61.0%) | **-30.2** |
| REFUTES | 163/170 (95.9%) | 151/170 (88.8%) | **-7.1** |
| NOT_ENOUGH_INFO | 158/158 (100%) | 158/158 (100%) | 0.0 |

### VitaminC (N=500, sample seed=42)

| Label | Baseline | Two-Pass | Delta |
|-------|----------|----------|-------|
| SUPPORTS | 236/259 (91.1%) | 213/259 (82.2%) | **-8.9** |
| REFUTES | 148/178 (83.1%) | 139/178 (78.1%) | **-5.1** |
| NOT_ENOUGH_INFO | 35/63 (55.6%) | 41/63 (65.1%) | +9.5 |

### SciFact (N=321, full dev set)

| Label | Sonnet Baseline | Opus Baseline |
|-------|-----------------|---------------|
| SUPPORTS | 98/138 (71.0%) | 107/138 (77.5%) |
| REFUTES | 67/71 (94.4%) | 67/71 (94.4%) |
| NOT_ENOUGH_INFO | 91/112 (81.3%) | 94/112 (83.9%) |

SciFact two-pass results not yet available at full scale.

## Analysis

### The information loss problem

Two-pass consistently hurts SUPPORTS accuracy — the category where the evidence *does* back the claim. The summarization step paraphrases away precise details, making the compare pass unable to confidently confirm support.

The damage is worst on FEVER (-30.2 pp on SUPPORTS), where claims are precise factual statements about Wikipedia entities. When the evidence says "the film was released on March 15, 2019" and the summary says "the film was released in early 2019", the compare pass can't verify a claim about the exact date.

### Where two-pass helps

The one bright spot: NOT_ENOUGH_INFO on VitaminC improved +9.5 pp. When evidence is genuinely insufficient, the summarization step correctly surfaces gaps, and the compare pass is more willing to say "not enough info." Two-pass adds healthy skepticism — but too much of it.

On FEVER, NEI was already at 100% baseline, so there's no room to improve.

### The tradeoff

Two-pass trades **detail preservation** for **anchoring resistance**:

- When the dominant error is **anchoring** (model reads evidence through lens of claim, confirms what it expects) → two-pass helps
- When the dominant error is **detail mismatch** (precise facts, numbers, dates) → two-pass hurts because summarization is lossy

FEVER and VitaminC are detail-heavy tasks where the baseline model is already reading carefully. SciFact may be different — scientific reasoning involves more ambiguity about directionality and causation, where anchoring could be the bigger problem.

### Error patterns (VitaminC deep dive)

46 regressions (baseline right → two-pass wrong) vs 20 improvements:

- **71% of regressions are SUPPORTS claims** — evidence genuinely supports the claim but two-pass downgrades to NEI or flips to REFUTES
- Numeric/threshold claims are especially vulnerable: "less than 160 people", "under 200,000 copies" — summary paraphrases the number, compare pass can't verify the threshold
- The 20 improvements are mostly NEI corrections and fixing baseline over-confidence on REFUTES

## Next Steps

1. **Run SciFact two-pass** at full scale to confirm whether it's the exception (where two-pass helps)
2. **Run HealthVer** baseline and two-pass — scientific domain like SciFact but different evidence source
3. **Less-lossy summarization** — modify the summarize tool schema to preserve exact numbers, dates, names, and quotes rather than paraphrasing
4. **Hybrid approach** — pass raw evidence alongside the summary in pass 2, so the model can check details
5. **Error analysis on SciFact** — understand whether the error mode there is genuinely anchoring (which two-pass fixes) vs detail loss (which it causes)
