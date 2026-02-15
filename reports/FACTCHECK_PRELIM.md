# Fact-Checking Benchmarks: Preliminary Results

Model: `claude-sonnet-4-5-20250929` | Temperature: 0 | Date: 2026-02-15

## Summary

| Dataset | Baseline | Two-Pass | Delta | N |
|---------|----------|----------|-------|---|
| SciFact (Sonnet) | 79.8% | — | — | 321 |
| SciFact (Opus) | 83.5% | — | — | 321 |
| FEVER | **95.6%** | 82.8% | **-12.8** | 500 |
| VitaminC | **83.8%** | 78.6% | **-5.2** | 500 |
| HealthVer | **63.5%** | 53.0% | **-10.5** | 3,740 / 100 |

Two-pass is worse than baseline on both FEVER and VitaminC. The summarization step loses critical details. HealthVer is the hardest benchmark by far — the model struggles most with SUPPORTS claims in the health domain.

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

### HealthVer (Baseline N=3,740 full; Two-Pass N=100 sample)

| Label | Baseline | Two-Pass | Delta |
|-------|----------|----------|-------|
| SUPPORTS | 338/1204 (28.1%) | 7/39 (17.9%) | **-10.2** |
| REFUTES | 423/816 (51.8%) | 7/20 (35.0%) | **-16.8** |
| NOT_ENOUGH_INFO | 1615/1720 (93.9%) | 39/41 (95.1%) | +1.2 |

SUPPORTS accuracy is strikingly low at 28.1% baseline — and two-pass makes it worse (17.9%). The model defaults to NEI on health claims where the evidence actually supports the claim — likely because PubMed abstracts use hedged, qualified language ("may be associated with", "results suggest") that the model interprets as insufficient. Two-pass amplifies this by adding another layer of skepticism.

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

### HealthVer: why so hard?

HealthVer SUPPORTS accuracy (28.1%) is dramatically lower than FEVER (91.3%) or VitaminC (91.1%). The model over-predicts NOT_ENOUGH_INFO on health claims. Likely causes:

- **Hedged language**: PubMed abstracts say "may be associated with", "results suggest", "further research is needed" — the model reads this as insufficient evidence rather than support
- **Domain complexity**: health claims involve causal reasoning about treatments, risk factors, and outcomes that require domain expertise to evaluate
- **Label semantics mismatch**: HealthVer's "Support" may have a lower bar than what the model considers sufficient — if a study shows a trend, HealthVer labels it Support, but the model wants stronger evidence

This makes HealthVer the most interesting benchmark for improvement — there's 36 points of headroom on SUPPORTS alone.

## Next Steps

1. **HealthVer error analysis** — look at SUPPORTS failures to understand the hedged-language hypothesis
2. **Run SciFact two-pass** at full scale to confirm whether scientific domains benefit from two-pass
3. **HealthVer two-pass on a sample** — `--sample 500` to see if two-pass helps or hurts on scientific health claims
4. **Less-lossy summarization** — modify the summarize tool schema to preserve exact numbers, dates, names, and quotes rather than paraphrasing
5. **Hybrid approach** — pass raw evidence alongside the summary in pass 2, so the model can check details
6. **Prompt tuning for HealthVer** — calibrate the SUPPORTS threshold, possibly with few-shot examples showing hedged language that still counts as support
