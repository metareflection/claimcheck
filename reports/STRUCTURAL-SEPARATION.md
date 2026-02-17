# Decoupling Representation from Evaluation in LLM Reasoning

## Core Idea

When LLMs evaluate a hypothesis against evidence, the default reasoning path is:

```
h = f(input)
verdict = g(h, input)       # representation is conditioned on hypothesis
```

The model forms a hypothesis early, then constructs a representation of the evidence conditioned on that hypothesis. This leads to premature hypothesis fixation.

Structural separation forces a different path:

```
E = R(input)                 # representation (hypothesis-free)
L = C(E)                     # local commitments
verdict = A(L)               # aggregation
```

The model builds a representation of the evidence *before* any hypothesis exists, makes local commitments about what each piece of evidence means, and only then aggregates into a global judgment. Local commitments are locked in before the global hypothesis forms, preventing selective reinterpretation.

The intervention operates through two distinct mechanisms depending on the domain:

1. **Representation isolation** (Dafny): The hypothesis is literally hidden during representation construction. The model informalizes code without seeing the NL requirement. This is information hiding.
2. **Structured intermediate representation** (Fact-checking, Mystery): The model sees all information but must produce atomic local commitments via a tool schema before aggregating. Decomposition creates a structured representation that explicit aggregation rules can operate on — without it, the model produces a single black-box verdict with no separable aggregation step.

## Three Domains

| Phase | Dafny Verification | Fact-Checking (NLI) | Mystery Solving |
|-------|-------------------|---------------------|-----------------|
| **Input** | Lemma code + NL requirement | Claim + evidence passage | Story + question + choices |
| **Mechanism** | Representation isolation (hypothesis hidden) | Structured intermediate representation | Structured intermediate representation |
| **R: Representation** | Informalize each clause (without seeing requirement) | Decompose claim into assertions | Extract quoted clues from story |
| **C: Local commitments** | What each clause means in English | Per-assertion: SUPPORTS / CONTRADICTS / NO_EVIDENCE | Per-clue: who it implicates / exonerates |
| **A: Aggregation** | Compare informalization to requirement | Soft-agg + contrastive → verdict | Per-choice evaluation → answer |
| **Failure mode prevented** | Hypothesis-conditioned representation | Black-box verdict with no separable aggregation | Premature fixation on plausible choice |

## Results

### Dafny Verification (N=36, 3 runs)

| Method | Accuracy | Description |
|--------|----------|-------------|
| No separation (Claude Code) | 69.4% | Model sees requirement + code together |
| Prompt-level separation | 86.1% | Single call, instructions say "informalize first" |
| **Structural separation** | **96.3%** | Two calls: informalize without seeing requirement, then compare |

The 26.9pp gap between no separation and structural separation is the clearest demonstration of anchoring bias. Even prompt-level instructions to "analyze first" lose 10.2pp vs actual structural enforcement. The model *cannot help* being influenced by the requirement when it's visible.

All three variants catch all 8 deliberately bogus lemmas (100%). The accuracy difference comes entirely from false disputes of valid lemmas — structural separation reduces false positives.

### Fact-Checking (7 datasets)

| Dataset | Domain | N | Baseline | Structured | Delta |
|---------|--------|---|----------|------------|-------|
| AVeriTeC | Real-world fact-checks | 500 | 67.6% | 72.8% | **+5.2pp** |
| HealthVer | Health/COVID claims | 3,740 | 63.5% | 68.6% | **+5.1pp** |
| PubHealth | Public health claims | 500 | 63.0% | 66.0% | **+3.0pp** |
| SciFact | Scientific claims | 321 | 79.8% | 80.7% | +0.9pp |
| FEVER | Wikipedia claims | 500 | 95.6% | 96.4% | +0.8pp |
| Climate-FEVER | Climate claims | 500 | 53.2% | 53.4% | +0.2pp |
| VitaminC | Wikipedia (contrastive) | 500 | 83.8% | 83.8% | +0.0pp |

Structured = grounded decomposition with soft aggregation and contrastive analysis.

The gain correlates with how conservative the baseline is on SUPPORTS. When the baseline already achieves >90% SUPPORTS accuracy (FEVER, VitaminC), there is no anchoring bias to correct. When the baseline is below 70% on SUPPORTS (HealthVer, AVeriTeC, PubHealth, SciFact), the model is defaulting to NOT_ENOUGH_INFO due to confirmation bias on "insufficient evidence" — structural separation corrects this.

### Mystery Solving (BIG-bench Minute Mysteries, N=203)

| Method | Sonnet | Opus |
|--------|--------|------|
| Baseline | 54.2% | 65.0% |
| Grounded (local commitments only) | 60.6% (+6.4pp) | 69.5% (+4.5pp) |
| Grounded + contrastive (full aggregation) | 64.5% (+10.3pp) | 70.0% (+5.0pp) |


## Ablation: Which Phase Matters?

HealthVer, N=500, seed 42.

| Config | Accuracy | SUPPORTS | REFUTES | NEI |
|--------|----------|----------|---------|-----|
| Baseline (no decomposition) | 65.4% | 28% | 58% | 93% |
| + Atomic representation + local commitments | 63.8% (-1.6pp) | 25% | 57% | 92% |
| + Soft aggregation | 67.8% (+2.4pp) | 37% | 62% | 90% |
| + Contrastive aggregation | 65.8% (+0.4pp) | 28% | 61% | 93% |
| + Both (soft + contrastive) | **68.8%** (+3.4pp) | **42%** | 61% | 90% |

Deltas relative to baseline.

**Decomposition alone hurts.** Without proper aggregation, atomic representation makes the model *more* conservative. It sees that not every assertion is fully supported and defaults to NOT_ENOUGH_INFO. The local commitments are reasonable but the implicit aggregation rule (all assertions must be supported) is wrong for this domain.

**Soft aggregation is the main driver.** It changes the aggregation rule from "all assertions must be supported" to "most supported, none contradicted." This matches the entailment threshold used by human annotators. Critically, soft-agg is only possible *because* decomposition creates separable local commitments — without the structured intermediate representation, there is nothing to aggregate over. Decomposition enables aggregation design.

**Contrastive adds a modest boost** by forcing explicit per-hypothesis evaluation. It mainly improves REFUTES detection (+4pp). Analysis of local commitment quality shows contrastive does not systematically change assertion-level labels (88% of entries have identical local labels with and without contrastive). Instead, it corrects specific misclassifications on boundary cases — when combined with soft-agg, these targeted corrections are amplified by the relaxed aggregation threshold.

**The two are super-additive.** Soft-agg alone: +2.4pp. Contrastive alone: +0.4pp. Both: +3.4pp. The super-additivity arises because contrastive fixes a small number of local misclassifications (8/17 entries where `both` wins over `softagg` show changed local labels) that soft-agg's relaxed threshold then correctly aggregates.

**Note:** Unlike Dafny, where the gain comes from representation isolation (hiding the hypothesis), fact-checking gains come primarily from aggregation design over the structured representation. These are distinct mechanisms unified by the same principle: decoupling representation from evaluation creates a structured intermediate form that can be reasoned about explicitly.

## Why It Works: Premature Hypothesis Fixation

The baseline failure mode is **hypothesis-conditioned evidence encoding**: the model forms or sees a hypothesis early, then constructs its representation of the evidence conditioned on that hypothesis. This manifests differently in each domain:

**Dafny (representation conditioning):** Model sees the NL requirement "counter is always non-negative" alongside the code. When it reads `ensures m >= -1`, it's primed to interpret this as confirming non-negativity, missing the subtle weakening. The representation of the code is literally conditioned on the hypothesis (the requirement).

**Fact-checking (aggregation-before-representation):** Without decomposition, the model produces a single verdict without separable local commitments. It cannot distinguish "topically related" from "logically entailing" because the aggregation is entangled with the representation. With decomposition, the structured intermediate representation enables explicit aggregation rules.

**Mystery (hypothesis competition failure):** Model sees answer choices before analyzing clues. It fixates on a plausible-sounding choice and selectively weighs clues that confirm it, rather than evaluating all choices against all evidence. The contrastive schema forces explicit per-choice evaluation, which is why contrastive adds +3.9pp in mystery (vs +0.4pp in fact-checking where hypothesis competition is less relevant).

## Connection to Existing Frameworks

The structured approach is analogous to Analysis of Competing Hypotheses (ACH) in intelligence analysis — evaluate each piece of evidence against all hypotheses independently before aggregating. The key parallel: ACH's value comes not from improving evidence collection, but from *separating evidence evaluation from hypothesis selection*.

The Dafny result connects to work on anchoring effects in LLMs (e.g., Jones & Steinhardt, 2022), but with a stronger finding: prompt-level instructions to "ignore the anchor" are insufficient (86.1%), while structural enforcement works (96.3%). This suggests LLM anchoring is not a compliance failure but a representational one — the model's encoding of the evidence is already contaminated by hypothesis visibility.

## Mechanism: Tool Schemas as Structural Enforcement

All three domains use tool-use schemas to enforce the phase ordering. The model must produce structured JSON matching a schema that requires:

1. Evidence fields (quotes, informalizations, assertions) before
2. Commitment fields (implications, relationships) before
3. Judgment fields (verdict, answer)

This is stronger than prompt-level instructions ("analyze before judging") because:
- The schema is a hard constraint, not a suggestion
- The model cannot skip phases or reorder them
- The output is machine-readable and auditable

The Dafny results quantify this: structural separation (96.3%) vs prompt-level separation (86.1%) — a 10.2pp gap from enforcement mechanism alone.

## Reproducibility

All results use Anthropic API with tool use. Temperature 0.

```bash
# Dafny verification
node eval/bench-claimcheck.js

# Fact-checking (example: HealthVer)
node eval/bench-healthver.js --mode baseline --label healthver-baseline
node eval/bench-healthver.js --mode grounded --soft-agg --contrastive \
  --concurrency 10 --label healthver-grounded

# Mystery solving
node eval/bench-mystery.js --mode baseline --label mystery-baseline
node eval/bench-mystery.js --mode grounded --concurrency 10 --label mystery-grounded
node eval/bench-mystery.js --mode grounded --contrastive --concurrency 10 --label mystery-grounded-contrastive

# Ablation (HealthVer, 500 sample)
node eval/bench-healthver.js --mode grounded --sample 500 --concurrency 10 --label ablation-neither
node eval/bench-healthver.js --mode grounded --soft-agg --sample 500 --concurrency 10 --label ablation-softagg
node eval/bench-healthver.js --mode grounded --contrastive --sample 500 --concurrency 10 --label ablation-contrastive
node eval/bench-healthver.js --mode grounded --soft-agg --contrastive --sample 500 --concurrency 10 --label ablation-both
```

Models: `claude-sonnet-4-5-20250929`, `claude-opus-4-6`.
