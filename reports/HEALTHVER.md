# HealthVer: Grounded Decomposition and Learned Aggregation

Model: `claude-sonnet-4-5-20250929` | Date: 2026-02-16

## TL;DR

Grounded decomposition — breaking claims into assertions and citing evidence per assertion — improves HealthVer accuracy from 63.5% (baseline) to 68.6% (+5.1pp). More interestingly, the model's per-assertion judgments are more informative than its own final verdict: a simple threshold over the assertion-level features adds another +1.2pp (to 70.0%) with no additional API calls. The model does good analysis but bad aggregation.

## Dataset Structure

HealthVer has only **460 unique claims** paired with **559 unique evidence passages**, yielding 3,740 claim-evidence entries (~8 evidence passages per claim). Each entry is independently labeled SUPPORTS, REFUTES, or NOT_ENOUGH_INFO depending on whether *that specific evidence* addresses the claim.

Label distribution: 1,204 SUPPORTS (32%), 816 REFUTES (22%), 1,720 NOT_ENOUGH_INFO (46%).

This structure means the same claim gets different labels with different evidence. 252 of 460 claims appear with multiple labels. The model must judge each (claim, evidence) pair independently — it cannot rely on the claim alone.

## Approaches Compared

All runs use the full 3,740-entry evaluation set (dev + test splits combined) unless noted.

### 1. Baseline (one-shot verdict)

The model sees claim + evidence and produces a verdict directly via tool use.

### 2. Two-Pass (blind summarize, then compare)

Pass 1: Summarize evidence without seeing the claim. Pass 2: Compare summary to claim. This was worse than baseline (53% on 100 examples) because blind summarization loses critical details.

### 3. Grounded Decomposition

The model must:
1. Break the claim into distinct assertions
2. Quote a specific evidence span for each assertion (or state "no relevant evidence")
3. Label each assertion SUPPORTS / CONTRADICTS / NO_EVIDENCE
4. Derive a final verdict

The structured tool schema enforces this order — the model must cite before judging. Two additional flags improve performance:

- **Soft aggregation** (`--soft-agg`): Relaxes the verdict rule from "all assertions must be supported" to "most assertions supported and none contradicted."
- **Contrastive analysis** (`--contrastive`): Forces the model to consider what evidence each verdict would require before choosing.

### 4. Grounded + Few-Shot Examples

Three boundary examples added to the prompt: one clear SUPPORTS, two topically-related-but-NEI cases.

### 5. Learned Aggregation

Instead of trusting the model's own verdict, extract features from the per-assertion structured output and learn a mapping to the gold label:

- `frac_sup`: fraction of assertions labeled SUPPORTS
- `frac_contra`: fraction labeled CONTRADICTS
- `frac_cited`: fraction with an actual evidence quote (vs "no relevant evidence")
- `has_sup`, `has_contra`: binary indicators

A threshold rule trained on 50% of the data: if any assertion has `frac_contra >= 0.05` → REFUTES; else if `frac_sup >= 0.05` → SUPPORTS; else → NOT_ENOUGH_INFO. This is evaluated on the held-out 50%.

## Results

### Overall Accuracy

| Approach | N | Accuracy |
|----------|---|----------|
| Baseline | 3,740 | 63.5% |
| Two-Pass | 100 | 53.0% |
| Grounded + soft-agg + contrastive | 3,740 | 67.9% |
| Grounded + few-shot | 3,740 | 68.0% |
| Grounded + few-shot (re-run w/ output saved) | 3,740 | 68.6% |
| **Learned threshold (held-out test)** | **1,864** | **70.0%** |

### Per-Label Breakdown (held-out test set, N=1,864)

| Label | Model Verdict | Threshold Rule | Logistic Regression |
|-------|---------------|----------------|---------------------|
| SUPPORTS (622) | 273 (44%) | 358 (58%) | 424 (68%) |
| REFUTES (391) | 225 (58%) | 226 (58%) | 226 (58%) |
| NOT_ENOUGH_INFO (851) | 785 (92%) | 721 (85%) | 634 (75%) |
| **Overall** | **68.8%** | **70.0%** | **68.9%** |

The threshold rule improves SUPPORTS by +14pp while only losing 7pp on NEI — a better tradeoff than logistic regression, which over-corrects.

## Analysis

### Why the model's verdict is too conservative

The dominant error is SUPPORTS classified as NOT_ENOUGH_INFO (574 cases in the full grounded run). The model correctly identifies partial evidence but then hedges to NEI because not every assertion is covered. However, the gold labels treat "evidence broadly consistent with the claim" as SUPPORTS even when specific details aren't mentioned.

Example: Claim says "patients with sufficient vitamin D were 51% less likely to die." Evidence is a general discussion of vitamin D's role in COVID immunity and inflammation. Gold label: SUPPORTS. Model says: NOT_ENOUGH_INFO (the 51% figure is never mentioned).

71% of these SUPPORTS-to-NEI errors involve evidence that is also labeled NEI for *other* claims — confirming that the evidence is genuinely indirect and the labeling convention is lenient.

### Why learned aggregation helps

The model's per-assertion analysis is more honest than its verdict. When it finds *any* quotable evidence span for an assertion (even one it labels NO_EVIDENCE in the relationship field), the gold label is likely SUPPORTS or REFUTES rather than NEI. The `frac_cited` feature — whether the model actually quoted evidence — is the strongest predictor in the logistic regression (coefficient: -1.39 for NEI).

The thresholds are remarkably low: `frac_sup >= 0.05` is enough to predict SUPPORTS. This means that if even one assertion out of twenty gets a SUPPORTS label, the overall verdict should probably be SUPPORTS. The model's own aggregation effectively requires a much higher bar.

### Logistic regression coefficients

| Feature | SUPPORTS | REFUTES | NEI |
|---------|----------|---------|-----|
| has_contra | -0.89 | **+2.07** | -1.19 |
| frac_cited | **+0.83** | +0.56 | **-1.39** |
| has_sup | **+0.80** | -0.04 | -0.71 |
| frac_noev | -0.21 | +0.40 | +0.21 |

The strongest signal for NEI is low `frac_cited` — the model didn't find quotable evidence. The strongest signal for REFUTES is `has_contra` — any contradiction dominates. SUPPORTS is predicted by `has_sup` and `frac_cited` together.

## Instruction Tuning Attempts

We attempted to improve accuracy by modifying the grounded instructions:

1. **Specificity language** ("evidence must directly state what the assertion says"): Improved NEI (+5pp) but crushed SUPPORTS (-16pp) and REFUTES (-10pp). Overall worse (62.5% vs 67.0% on 200 sample). The model became too conservative.

2. **Softened specificity** ("be careful about specificity"): Same result. The instruction-level framing is too blunt — any language cautioning against over-commitment causes the model to retreat to NEI across the board.

3. **Few-shot examples** (3 boundary cases): Marginal gain (+0.1pp overall). Helped SUPPORTS and NEI slightly, hurt REFUTES. The examples improved the 200-sample pilot (+2pp) but the effect didn't hold at scale.

Conclusion: prompt engineering has limited headroom on this task. The model's *reasoning* is already good; the problem is in *decision-making* at the aggregation step.

## Connection to ClaimCheck

This mirrors ClaimCheck's core finding on Dafny verification-of-intent: **structural separation outperforms monolithic prompting**. In ClaimCheck, informalizing lemmas *without seeing requirements* then comparing prevents anchoring bias (96.3% vs 69.4%). Here, decomposing claims into assertions and grounding each one independently prevents the model from pattern-matching on topical overlap.

The learned aggregation extends this: the model's structured intermediate representation (per-assertion evidence grounding) is a better input to a decision function than the model's own verdict. The LLM is the feature extractor; aggregation is a separable, learnable step.

## Reproducibility

All results use `claude-sonnet-4-5-20250929` via the Anthropic API with tool use.

```bash
# Baseline
node eval/bench-healthver.js --mode baseline --label healthver-baseline

# Grounded with soft-agg + contrastive + concurrency
node eval/bench-healthver.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label healthver-grounded-features-full

# Learned aggregation is computed offline from the saved grounded output.
```

Result files in `eval/results/`:
- `healthver-baseline.json`
- `healthver-grounded-both.json` (first grounded run, no assertion output saved)
- `healthver-grounded-features-full.json` (full run with assertion-level output)
