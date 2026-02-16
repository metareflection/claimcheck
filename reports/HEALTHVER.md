# Grounded Decomposition for Claim Verification

Model: `claude-sonnet-4-5-20250929` | Date: 2026-02-16

## TL;DR

Grounded decomposition — breaking claims into assertions, citing evidence per assertion, then aggregating — improves accuracy on HealthVer (+5.1pp) and SciFact (+0.9pp), with smaller gains on FEVER (+0.8pp) and no change on VitaminC. The improvement comes almost entirely from better SUPPORTS detection: the model learns to commit to SUPPORTS when it can cite specific evidence, instead of hedging to NOT_ENOUGH_INFO. The technique produces an auditable per-assertion trace as a side effect.

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

| Dataset | N | Baseline | Grounded | Delta |
|---------|---|----------|----------|-------|
| HealthVer | 3,740 | 63.5% | 68.6% | **+5.1pp** |
| SciFact | 321 | 79.8% | 80.7% | +0.9pp |
| FEVER | 500 | 95.6% | 96.4% | +0.8pp |
| VitaminC | 500 | 83.8% | 83.8% | +0.0pp |

### Per-Label Breakdown

| Dataset | Label | Baseline | Grounded | Delta |
|---------|-------|----------|----------|-------|
| **HealthVer** | SUPPORTS | 28% | 46% | **+18pp** |
| | REFUTES | 52% | 55% | +3pp |
| | NOT_ENOUGH_INFO | 94% | 90% | -3pp |
| **SciFact** | SUPPORTS | 71% | 81% | **+10pp** |
| | REFUTES | 94% | 93% | -1pp |
| | NOT_ENOUGH_INFO | 81% | 72% | -9pp |
| **FEVER** | SUPPORTS | 91% | 92% | +1pp |
| | REFUTES | 96% | 98% | +2pp |
| | NOT_ENOUGH_INFO | 100% | 100% | +0pp |
| **VitaminC** | SUPPORTS | 91% | 91% | +0pp |
| | REFUTES | 83% | 87% | +3pp |
| | NOT_ENOUGH_INFO | 56% | 46% | -10pp |

The pattern is consistent: grounded decomposition improves SUPPORTS detection at the cost of some NOT_ENOUGH_INFO accuracy. The tradeoff is favorable when the baseline under-predicts SUPPORTS (HealthVer, SciFact) and neutral or negative when SUPPORTS is already well-calibrated (FEVER, VitaminC).

## HealthVer Deep Dive

HealthVer shows the largest improvement and has the most interesting error structure, so the rest of this report focuses on it.

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

### Other Approaches Tried

**Two-Pass** (blind summarize, then compare): 53% on 100 examples. Worse than baseline because blind summarization loses critical details.

**Instruction tuning** (adding specificity language to the grounded prompt): Improved NOT_ENOUGH_INFO (+5pp) but crushed SUPPORTS (-16pp). The model became uniformly conservative. Softened versions had the same problem. Instruction-level framing is too blunt for calibrating the SUPPORTS/NOT_ENOUGH_INFO boundary.

**Few-shot examples** (3 boundary cases): +2pp on a 200-sample pilot, but +0.1pp at full scale. The effect didn't hold.

### Observation: Per-Assertion Features vs. Model Verdict

The grounded output includes per-assertion relationships and evidence spans. Extracting simple features from these (fraction of assertions supported, fraction with quoted evidence) and training a threshold on 50% of the data yields 70.0% on the held-out 50% — modestly above the model's own 68.8%. The gain is concentrated in SUPPORTS (44% → 58%).

However, this effect is specific to HealthVer's high NOT_ENOUGH_INFO rate (46%) and the model's tendency to over-predict it. On FEVER (32% NOT_ENOUGH_INFO), the threshold adds only +0.8pp. On SciFact and VitaminC, it slightly hurts. The learned aggregation is not a general technique — it corrects for a dataset-specific miscalibration.

## Connection to ClaimCheck

Grounded decomposition applies the same principle as ClaimCheck's round-trip verification of Dafny lemmas: **structural separation**. In ClaimCheck, informalizing lemmas without seeing requirements prevents anchoring bias (96.3% vs 69.4% when the model sees both). Here, forcing per-assertion citation before verdict prevents the model from pattern-matching on topical overlap and makes the reasoning auditable.

The structured output — which assertions were supported, which lacked evidence, what was quoted — is arguably more valuable than the accuracy improvement. It turns a black-box verdict into a traceable argument.

## Reproducibility

All results use `claude-sonnet-4-5-20250929` via the Anthropic API with tool use.

```bash
# Baseline
node eval/bench-healthver.js --mode baseline --label healthver-baseline

# Grounded (with assertion-level output saved)
node eval/bench-healthver.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label healthver-grounded-features-full

# Cross-dataset
node eval/bench-scifact.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label scifact-grounded-features
node eval/bench-fever.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --sample 500 --label fever-grounded-features-s500
node eval/bench-vitaminc.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --sample 500 --label vitaminc-grounded-features-s500

# Learned aggregation analysis
python3 eval/learned-agg.py eval/results/healthver-grounded-features-full.json
```
