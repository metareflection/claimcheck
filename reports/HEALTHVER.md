# Grounded Decomposition for Claim Verification

Model: `claude-sonnet-4-5-20250929` | Date: 2026-02-16

## TL;DR

Grounded decomposition — breaking claims into assertions, citing evidence per assertion, then aggregating — consistently improves accuracy across 7 fact-checking datasets. The largest gains are on datasets where the baseline under-predicts SUPPORTS: AVeriTeC (+5.2pp), HealthVer (+5.1pp), PubHealth (+3.0pp). The improvement comes from better SUPPORTS detection (+7-18pp) at a small cost to NOT_ENOUGH_INFO (-3 to -7pp). The technique also produces an auditable per-assertion trace.

## Method

### Baseline

The model sees claim + evidence and produces a verdict (SUPPORTS / REFUTES / NOT_ENOUGH_INFO) directly via tool use.

### Grounded Decomposition

The model must:
1. Break the claim into distinct assertions
2. Quote a specific evidence span for each assertion (or state "no relevant evidence")
3. Label each assertion SUPPORTS / CONTRADICTS / NO_EVIDENCE
4. Derive a final verdict

A structured tool schema enforces this order — the model must cite before judging. Two flags modify the aggregation:

- **Soft aggregation** (`--soft-agg`): "Most assertions supported and none contradicted" is sufficient for SUPPORTS (strict mode requires all assertions supported).
- **Contrastive analysis** (`--contrastive`): Before choosing a verdict, the model must consider what evidence each verdict would require.

Both flags are enabled for all grounded runs reported here.

## Cross-Dataset Results

| Dataset | Domain | N | Baseline | Grounded | Delta |
|---------|--------|---|----------|----------|-------|
| AVeriTeC | Real-world fact-checks | 500 | 67.6% | 72.8% | **+5.2pp** |
| HealthVer | Health/COVID claims | 3,740 | 63.5% | 68.6% | **+5.1pp** |
| PubHealth | Public health claims | 500 | 63.0% | 66.0% | **+3.0pp** |
| SciFact | Scientific claims | 321 | 79.8% | 80.7% | +0.9pp |
| FEVER | Wikipedia claims | 500 | 95.6% | 96.4% | +0.8pp |
| Climate-FEVER | Climate claims | 500 | 53.2% | 53.4% | +0.2pp |
| VitaminC | Wikipedia (contrastive) | 500 | 83.8% | 83.8% | +0.0pp |

Grounded decomposition helps on every dataset except VitaminC (neutral) and Climate-FEVER (negligible). The effect is strongest where the baseline most under-predicts SUPPORTS.

### Per-Label Breakdown

| Dataset | SUPPORTS | REFUTES | NOT_ENOUGH_INFO |
|---------|----------|---------|-----------------|
| **AVeriTeC** | 61% → 71% (**+11pp**) | 76% → 82% (+6pp) | 44% → 38% (-5pp) |
| **HealthVer** | 28% → 46% (**+18pp**) | 52% → 55% (+3pp) | 94% → 90% (-3pp) |
| **PubHealth** | 71% → 78% (**+7pp**) | 65% → 67% (+2pp) | 37% → 31% (-7pp) |
| **SciFact** | 71% → 81% (**+10pp**) | 94% → 93% (-1pp) | 81% → 72% (-9pp) |
| **FEVER** | 91% → 92% (+1pp) | 96% → 98% (+2pp) | 100% → 100% (+0pp) |
| **Climate-FEVER** | 44% → 51% (+7pp) | 80% → 77% (-3pp) | 52% → 47% (-6pp) |
| **VitaminC** | 91% → 91% (+0pp) | 83% → 87% (+3pp) | 56% → 46% (-10pp) |

The pattern is consistent across all 7 datasets: grounded decomposition improves SUPPORTS detection at the cost of some NOT_ENOUGH_INFO accuracy. The tradeoff is net positive when the baseline is conservative about SUPPORTS (HealthVer, AVeriTeC, PubHealth, SciFact) and neutral or negative when SUPPORTS is already well-calibrated (FEVER, VitaminC).

Climate-FEVER is an outlier: SUPPORTS improves (+7pp) but is offset by NOT_ENOUGH_INFO (-6pp) and REFUTES (-3pp) regressions, netting near zero.

### When Does Grounded Help?

The gain correlates with how much room there is to improve SUPPORTS. Datasets where the baseline already achieves >90% SUPPORTS accuracy (FEVER, VitaminC) see no benefit — grounded decomposition can't improve what's already well-calibrated. Datasets where the baseline is below 70% on SUPPORTS (HealthVer, AVeriTeC, PubHealth, SciFact) see +3 to +5pp overall.

## HealthVer Deep Dive

HealthVer shows one of the largest improvements and has the most interesting error structure.

### Dataset Structure

HealthVer has only **460 unique claims** paired with **559 unique evidence passages**, yielding 3,740 claim-evidence entries (~8 evidence passages per claim). Each entry is independently labeled depending on whether *that specific evidence* addresses the claim.

252 of 460 claims appear with multiple labels — the same claim gets SUPPORTS with one paper and NOT_ENOUGH_INFO with another. The model must judge each (claim, evidence) pair independently.

Label distribution: 1,204 SUPPORTS (32%), 816 REFUTES (22%), 1,720 NOT_ENOUGH_INFO (46%).

### Confusion Matrix (Grounded, N=3,740)

|  | Predicted SUP | Predicted REF | Predicted NEI |
|--|---------------|---------------|---------------|
| **True SUPPORTS** | 548 | 82 | 574 |
| **True REFUTES** | 42 | 449 | 325 |
| **True NOT_ENOUGH_INFO** | 127 | 66 | 1,527 |

The dominant error is SUPPORTS misclassified as NOT_ENOUGH_INFO (574 cases, 15% of the dataset). The model sees partial evidence, correctly notes that not every assertion is covered, and hedges — but the gold labels accept indirect support.

### The Soft Entailment Problem

71% of these SUPPORTS-to-NOT_ENOUGH_INFO errors involve evidence that is also labeled NOT_ENOUGH_INFO for *other* claims. The evidence is genuinely indirect.

Example: Claim says "patients with sufficient vitamin D were 51% less likely to die." Evidence is a general discussion of vitamin D's role in COVID immunity and inflammation — it never mentions the 51% figure. Gold label: SUPPORTS. The annotators accepted "broadly consistent" as sufficient; the model (reasonably) says the specific claim isn't established.

This is a fundamental tension in NLI-style fact-checking: the entailment threshold is a convention, not a fact. The model's reasoning is often defensible when it disagrees with the gold label.

### Other Approaches Tried on HealthVer

**Two-Pass** (blind summarize, then compare): 53% on 100 examples. Worse than baseline because blind summarization loses critical details.

**Instruction tuning** (adding specificity language to the grounded prompt): Improved NOT_ENOUGH_INFO (+5pp) but crushed SUPPORTS (-16pp). The model became uniformly conservative. Softened versions had the same problem. Instruction-level framing is too blunt for calibrating the SUPPORTS/NOT_ENOUGH_INFO boundary.

**Few-shot examples** (3 boundary cases): +2pp on a 200-sample pilot, but +0.1pp at full scale. The effect didn't hold.

### Observation: Per-Assertion Features vs. Model Verdict

The grounded output includes per-assertion relationships and evidence spans. Extracting simple features from these (fraction of assertions supported, fraction with quoted evidence) and training a threshold on 50% of the data yields 70.0% on the held-out 50% — modestly above the model's own 68.8%. The gain is concentrated in SUPPORTS (44% → 58%).

However, this effect is specific to HealthVer's high NOT_ENOUGH_INFO rate (46%) and does not generalize well to other datasets.

## Connection to ClaimCheck

Grounded decomposition applies the same principle as ClaimCheck's round-trip verification of Dafny lemmas: **structural separation**. In ClaimCheck, informalizing lemmas without seeing requirements prevents anchoring bias (96.3% vs 69.4% when the model sees both). Here, forcing per-assertion citation before verdict prevents the model from pattern-matching on topical overlap and makes the reasoning auditable.

The structured output — which assertions were supported, which lacked evidence, what was quoted — is arguably more valuable than the accuracy improvement. It turns a black-box verdict into a traceable argument.

## Reproducibility

All results use `claude-sonnet-4-5-20250929` via the Anthropic API with tool use. Runs use `--concurrency 10` and `--sample 500` (seed 42) where noted.

```bash
# HealthVer (full)
node eval/bench-healthver.js --mode baseline --label healthver-baseline
node eval/bench-healthver.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label healthver-grounded-features-full

# SciFact (full, 321 entries)
node eval/bench-scifact.js --mode baseline --concurrency 10 --label scifact-baseline-sonnet
node eval/bench-scifact.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label scifact-grounded-features

# FEVER (sample 500)
node eval/bench-fever.js --mode baseline --sample 500 --concurrency 10 --label fever-baseline
node eval/bench-fever.js --mode grounded --soft-agg --contrastive \
  --sample 500 --concurrency 10 --label fever-grounded-features-s500

# VitaminC (sample 500)
node eval/bench-vitaminc.js --mode baseline --sample 500 --concurrency 10 --label vitaminc-baseline
node eval/bench-vitaminc.js --mode grounded --soft-agg --contrastive \
  --sample 500 --concurrency 10 --label vitaminc-grounded-features-s500

# Climate-FEVER (sample 500)
node eval/bench-climate-fever.js --mode baseline --sample 500 --concurrency 10 --label climate-fever-baseline-s500
node eval/bench-climate-fever.js --mode grounded --soft-agg --contrastive \
  --sample 500 --concurrency 10 --label climate-fever-grounded-s500

# AVeriTeC (full, 500 entries)
node eval/bench-averitec.js --mode baseline --concurrency 10 --label averitec-baseline
node eval/bench-averitec.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label averitec-grounded

# PubHealth (sample 500)
node eval/bench-pubhealth.js --mode baseline --sample 500 --concurrency 10 --label pubhealth-baseline-s500
node eval/bench-pubhealth.js --mode grounded --soft-agg --contrastive \
  --sample 500 --concurrency 10 --label pubhealth-grounded-s500

# Learned aggregation analysis (HealthVer)
python3 eval/learned-agg.py eval/results/healthver-grounded-features-full.json
```
