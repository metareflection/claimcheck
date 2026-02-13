# Design: Sentinel Proof Pipeline

## Problem

We have formal Dafny specifications and informal user requirements. We need to answer: does the spec cover the requirements?

The naive approach — translate Dafny to natural language, then ask an LLM "do these match?" — is fuzzy. Two layers of LLM interpretation, no formal guarantee.

## Key Insight

If the NL match says "requirement R is equivalent to lemma L", we should be able to write a **sentinel proof** — a trivial Dafny lemma whose body just calls L. If Dafny accepts it, the match is mathematically confirmed. The theorem prover becomes the judge, not the LLM.

## Architecture

```
Requirements (NL)          Dafny Domain
       │                        │
       │                   ┌────┴────┐
       │                   │ Flatten │ extract claims from AST
       │                   └────┬────┘
       │                        │ claims[]
       │                   ┌────┴─────┐
       │                   │Translate │ Dafny → NL (Haiku)
       │                   └────┬─────┘
       │                        │ claims[] + .naturalLanguage
       ├────────────┬───────────┘
                    │
              ┌─────┴─────┐
              │   Match   │ NL similarity → candidate hints (Sonnet)
              └─────┬─────┘
                    │ { matches[], unexpected[] }
              ┌─────┴─────┐
              │ Prove ALL │ for every requirement:
              │           │   sentinel → direct → LLM → retry
              └─────┬─────┘
                    │ results[] with status + strategy
              ┌─────┴──────┐
              │Obligations │ gap → obligations.dfy
              └────────────┘
```

## Sentinel Proofs

A sentinel proof is a Dafny lemma constructed mechanically from a matched claim. No LLM is needed for the proof body — just a Dafny verification call.

### Lemma claims — call the matched lemma

If requirement "every action preserves the invariant" matches `StepPreservesInv`:

```dafny
lemma Sentinel_StepPreservesInv(m: D.Model, a: D.Action)
  requires D.Inv(m)
  ensures D.Inv(D.Normalize(D.Apply(m, a)))
{
  D.StepPreservesInv(m, a);  // just call it
}
```

The `ensures` and `requires` come from the claims JSON. The parameter types come from regex-extracting the lemma signature from the Dafny source. The proof body is mechanical.

### Predicate claims — test implication

If requirement "counter is non-negative" matches invariant conjunct `m >= 0`:

```dafny
lemma Sentinel_Inv_0(m: D.Model)
  requires D.Inv(m)
  ensures m >= 0
{}  // Dafny expands Inv(m) and sees m >= 0
```

This tests `Inv(m) ⟹ m >= 0` — a direct implication check. Empty body, Dafny resolves it by expanding the predicate definition.

### Function contracts — assert the contract

```dafny
lemma Sentinel_Apply_requires_0(m: D.Model)
  requires D.Inv(m)
  ensures D.Inv(m)
{}
```

## Strategy Escalation

For each requirement, strategies are tried cheapest-first:

| Strategy | LLM calls | Dafny calls | When it works |
|----------|-----------|-------------|---------------|
| Sentinel | 0 | 1 per candidate | Match step found a correct candidate |
| Direct | 1 (formalize) | 1 | Property follows from definitions |
| LLM-guided | 1 (formalize) | 1 | Needs proof hints |
| Retry | 1 per retry | 1 per retry | First attempt had wrong types/hints |

Stops on first success. The result records which strategy succeeded and what was tried.

## Match vs Compare

The old pipeline had a **compare** step that output final verdicts (`proved`, `missing`, `unexpected`). The new **match** step outputs **candidate hints**:

```json
{
  "matches": [
    {
      "requirement": "The counter is always non-negative",
      "candidates": [
        { "claimId": "pred:CounterDomain.Inv:0", "confidence": 0.95, "explanation": "..." }
      ]
    }
  ],
  "unexpected": [...]
}
```

The LLM's job shifts from adjudication ("does A match B?") to suggestion ("A might be related to B"). Dafny makes the final call.

## Module Structure

```
src/
├── main.js        orchestration: flatten → translate → match → prove → obligations → report
├── flatten.js     dafny2js JSON → individual claim items
├── translate.js   formal claims → natural language (Haiku, batched)
├── match.js       NL similarity → candidate hints (Sonnet)
├── sentinel.js    construct sentinel proofs from matched claims
├── prove.js       strategy escalation: sentinel → direct → LLM → retry
├── verify.js      run Dafny on generated lemmas
├── obligations.js generate obligations.dfy for gaps
├── report.js      markdown/JSON output + legacy coverage adapter
├── compare.js     (legacy, kept for eval backward compat)
├── prompts.js     all LLM prompt templates
├── schemas.js     tool-use schemas for LLM responses
├── api.js         Anthropic API wrapper
└── extract.js     run dafny2js --claims
```

## Backward Compatibility

The `buildLegacyCoverage()` function in `report.js` reconstructs the old `{ proved, missing, unexpected, summary }` shape from match + prove results. This keeps the promptfoo eval framework working without changes to ground truth files or assertions.

The old `compare.js` module is preserved — the eval provider can still import and use it directly.
