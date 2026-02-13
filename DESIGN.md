# Design: Claim Check Pipeline

## Problem

We have formal Dafny specifications and informal user requirements. We need to answer: does the spec cover the requirements?

The naive approach — translate Dafny to natural language, then ask an LLM "do these match?" — is fuzzy. Two layers of LLM interpretation, no formal guarantee.

## Key Insight

The theorem prover should be the judge, not the LLM. For every requirement, we formalize it as a Dafny lemma (`requires Inv(m); ensures P(m)`) and ask Dafny to verify it. If Dafny accepts, the requirement is formally covered.

The invariant `Inv(m)` is the central specification — it characterizes all valid states. Any state property follows from the invariant, and Dafny can check arbitrary consequences. Matched claims (invariant conjuncts, proved lemmas, function contracts) serve as **hints** to guide the LLM in writing the proof, but never as the `ensures` clause itself.

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
              │           │   direct → LLM-guided → retry
              └─────┬─────┘
                    │ results[] with status + strategy
              ┌─────┴──────┐
              │Obligations │ gap → obligations.dfy
              └────────────┘
```

## Invariant as Specification

The domain invariant `Inv(m)` is a conjunction of clauses that characterizes all valid states. It can answer two kinds of questions:

**State properties** ("what's true of valid states"): Any property P that follows from the invariant — whether it's a direct conjunct or an arbitrary logical consequence — can be checked with:

```dafny
lemma PropertyHolds(m: D.Model)
  requires D.Inv(m)
  ensures P(m)
{}  // Dafny unfolds Inv(m) and checks P(m)
```

Many requirements are state properties. The invariant conjuncts (surfaced by dafny2js) give the LLM context about what the invariant contains, helping it write `P(m)` correctly.

**Behavioral properties** ("what a specific action does"): Properties like "decrementing at zero is a no-op" require reasoning about `Apply`. The invariant provides the precondition (`requires Inv(m)`), but the `ensures` involves function behavior:

```dafny
lemma DecrementAtZeroIsNoOp(m: D.Model)
  requires D.Inv(m)
  requires m == 0
  ensures D.Normalize(D.Apply(m, D.Dec)) == 0
{}  // Dafny unfolds Apply and Normalize
```

**Preservation** ("invariant survives transitions"): Proved by lemmas like `StepPreservesInv`. These lemmas are passed as hints — the LLM can call them in the proof body.

## Hint-Guided Formalization

All matched claims become **hints** for the formalize step:

- **Invariant conjuncts**: Tell the LLM what the invariant contains (e.g., `m >= 0` is a conjunct)
- **Proved lemmas**: Can be called in the proof body (e.g., `D.StepPreservesInv(m, a)`)
- **Function contracts**: Provide context about preconditions and postconditions

The LLM always writes the `ensures` from the requirement. Dafny verifies that it actually follows.

```
Requirement: "the counter is always non-negative"
Hint: Invariant conjunct: `m >= 0`

→ LLM writes: requires D.Inv(m); ensures m >= 0
→ Dafny verifies: ✓ (m >= 0 is a conjunct of Inv)
```

```
Requirement: "every action preserves the invariant"
Hint: Proved lemma: `StepPreservesInv(m: D.Model, a: D.Action)` ensures `D.Inv(D.Normalize(D.Apply(m, a)))`

→ LLM writes: requires D.Inv(m); ensures D.Inv(D.Normalize(D.Apply(m, a)))
→ LLM calls D.StepPreservesInv(m, a) in body
→ Dafny verifies: ✓
```

```
Requirement: "granting to a non-existent subject is a no-op"
Hint: Invariant conjunct: `forall sc in m.grants :: sc.0 in m.subjects`

→ LLM writes: requires D.Inv(m); requires subj !in m.subjects; ensures D.Apply(m, D.Grant(subj, cap)) == m
→ Dafny verifies by unfolding Apply: ✓ or ✗
```

The third example shows why hints must not be the `ensures`: the conjunct ("grants reference existing subjects") is a state property, but the requirement ("granting is a no-op") is behavioral. The `ensures` must come from the requirement.

## Strategy Escalation

For each requirement, strategies are tried cheapest-first:

| Strategy | LLM calls | Dafny calls | When it works |
|----------|-----------|-------------|---------------|
| Direct | 1 (formalize) | 1 | Property follows from definitions |
| LLM-guided | 1 (retry) | 1 | Needs proof body or different approach |
| Retry | 1 per retry | 1 per retry | First attempt had wrong types/hints |

Matched claims are collected as hints and passed to the formalize step. The LLM uses them for context and proof guidance.

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
├── sentinel.js    build hint text from matched claims for formalize prompt
├── prove.js       strategy escalation: direct → LLM-guided → retry
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
