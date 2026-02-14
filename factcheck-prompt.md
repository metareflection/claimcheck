# Factcheck: Two-Pass Claim Verification for Mystery QA

Applies the same two-pass architecture from claimcheck (formal verification) to informal claim checking — specifically, mystery story question-answering.

## Core Insight

The same anchoring bias that affects formal claim checking also affects informal reasoning. If a model sees the answer choices before analyzing the story, it may anchor on a plausible-sounding choice and reason backwards to justify it. Forcing analysis before seeing choices should produce better reasoning.

## Architecture

### Baseline (single-pass)

The model sees the story, question, and answer choices all at once.

```
Story + Question + Choices → Answer
```

### Two-pass

**Pass 1 — Analyze (without seeing choices):**

The model reads the story and question only. It must:
- Summarize the key events and timeline
- Identify all suspects/candidates
- List the clues and evidence for/against each candidate
- Reason about contradictions, alibis, and red herrings
- State its conclusion before seeing the choices

**Pass 2 — Select (with choices):**

The model receives its own Pass 1 analysis plus the answer choices. It must:
- Map its analysis to the available choices
- Check if its reasoning supports one of the given options
- If its conclusion doesn't match any choice, reconsider based on the evidence
- Select a final answer

## Key Differences from Formal Claimcheck

| | Formal (claimcheck) | Informal (factcheck) |
|---|---|---|
| Evidence | Dafny lemma code | Story text |
| Claim | NL requirement | Answer choice |
| Pass 1 | Informalize code → English | Analyze story → reasoning |
| Pass 2 | Compare informalization vs requirement | Match reasoning to choices |
| Bias prevented | Anchoring on NL when reading code | Anchoring on choices when reading story |
| Ground truth | Expected confirmed/disputed | Correct answer in target_scores |
| Metric | Accuracy (correct verdict) | Accuracy (correct choice) |

## Dataset

BIG-bench Minute Mysteries QA (multiple choice subtask):
- 203 mystery stories with questions
- 3-5 answer choices per story, exactly one correct
- Questions are embedded at the end of each story
- Source: 5minutemystery.com and Project Gutenberg

## Evaluation

```bash
# Baseline: model sees everything at once
node eval/bench-mystery.js --mode baseline --label mystery-baseline

# Two-pass: analyze first, then choose
node eval/bench-mystery.js --mode two-pass --label mystery-two-pass

# Compare
node eval/compare-mystery.js mystery-baseline mystery-two-pass
```

## Hypothesis

Two-pass will outperform baseline on mysteries where:
1. There are plausible-sounding wrong answers (red herrings)
2. The correct answer requires multi-step reasoning through clues
3. The story is long enough that the model might latch onto a choice early

Two-pass may not help (or even hurt) on:
1. Very short/simple mysteries where the answer is obvious
2. Cases where the choices themselves contain useful framing information
