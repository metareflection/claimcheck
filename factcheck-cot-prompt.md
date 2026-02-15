# Factcheck CoT: Evidence-Grounded Claim Verification

No verdict without a grounding chain. The model must cite evidence before judging — if it can't point to a specific span, it can't claim support.

## Core Insight

Baseline factchecking asks the model to read evidence and render a verdict in one step. This lets the model skip straight to pattern-matching ("this sounds right") without checking what the evidence actually says. Two-pass (blind summarize, then compare) avoids anchoring but loses information in the summarization step.

Evidence-grounded CoT forces a middle path: the model sees both claim and evidence, but must decompose the claim into assertions and cite specific evidence for each one before reaching a verdict. The structured output makes the reasoning auditable — you can see exactly which evidence span drove each judgment.

## Architecture

Single API call with structured output.

```
Claim + Evidence → [per-assertion grounding] → Verdict
```

**Step 1 — Decompose.** Break the claim into distinct assertions.

**Step 2 — Ground.** For each assertion, quote the evidence span that addresses it, or state "no relevant evidence."

**Step 3 — Judge.** State the relationship per assertion: SUPPORTS, CONTRADICTS, or NO_EVIDENCE.

**Step 4 — Aggregate.** Derive the final verdict:
- All assertions supported → SUPPORTS
- Any contradiction → REFUTES
- Insufficient coverage → NOT_ENOUGH_INFO

## Key Differences from Other Modes

| | Baseline | Two-Pass | Grounded CoT |
|---|---|---|---|
| API calls | 1 | 2 | 1 |
| Sees claim during analysis | Yes | No (Pass 1) | Yes |
| Evidence citation | Implicit | None | Explicit per-assertion |
| Reasoning trace | Hidden | Split across passes | Structured, auditable |
| Bias risk | Anchoring | Information loss | Low (cite-before-judge) |

## Output Schema

```json
{
  "assertions": [
    {
      "text": "Men in Black II is a 1992 film",
      "evidence_span": "Men in Black II is a 2002 American science fiction action comedy film",
      "relationship": "CONTRADICTS",
      "reasoning": "The film was released in 2002, not 1992"
    }
  ],
  "verdict": "REFUTES"
}
```

The schema enforces ordering: `evidence_span` must be populated before `relationship`. The model cannot judge without citing.

## Evaluation

```bash
node eval/bench-fever.js     --mode grounded --label fever-grounded --sample 500
node eval/bench-scifact.js   --mode grounded --label scifact-grounded
node eval/bench-vitaminc.js  --mode grounded --label vitaminc-grounded --sample 500
node eval/bench-healthver.js --mode grounded --label healthver-grounded
```

Same samples (seed 42) as baseline and two-pass for direct comparison.

## Hypothesis

Grounded CoT should outperform baseline by forcing careful evidence reading, and outperform two-pass by avoiding the information loss of blind summarization. It should help most on:
1. Claims with multiple assertions where baseline might miss a contradiction
2. Cases where evidence is subtly different from the claim (dates, numbers, scope)
3. NOT_ENOUGH_INFO cases where the model needs to recognize what the evidence doesn't say
