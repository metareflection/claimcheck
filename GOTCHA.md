# Gotchas

## Sentinel ensures mismatch (false positives)

**Status:** Open

Sentinel proofs copy the `ensures` clause from the matched claim's original lemma, not from the requirement. This means a sentinel can verify successfully while proving something completely different from what the requirement asks.

### Example

Requirement: "Granting a capability to a non-existent subject is a no-op"

The match step suggests `StepPreservesInv` as a candidate. The sentinel builds:

```dafny
lemma Sentinel_StepPreservesInv(m: D.Model, a: D.Action)
  requires D.Inv(m)
  ensures D.Inv(Normalize(Apply(m, a)))   // ← from the original lemma
{
  D.StepPreservesInv(m, a);
}
```

Dafny accepts this — but it proved invariant preservation, not that the operation is a no-op (`Apply(m, a) == m`). The requirement wanted idempotence; the sentinel verified a completely unrelated property.

### Where it shows up

In the delegation-auth test, three distinct no-op requirements all "pass" via the same `StepPreservesInv` sentinel. In canon, "adding a node with an existing ID is a no-op" passes via `AddNodeImplPreservesInv`.

### Why it happens

The pipeline has two sources of semantics:
1. The **match step** (LLM) decides which claim is related to a requirement
2. The **sentinel** (mechanical) copies the matched claim's ensures clause

Neither step checks whether the claim's ensures clause actually *expresses* the requirement. The match step only checks NL similarity ("is this claim related?"), and the sentinel only checks Dafny validity ("does this lemma verify?"). The gap between "related" and "equivalent" is where false positives live.

### Possible fixes

- **Requirement-derived ensures:** Have the sentinel's ensures clause come from formalizing the requirement (LLM step), with the matched claim used only for the proof body. This turns the sentinel into a bridge: requirement semantics in the ensures, claim proof in the body.
- **Two-phase sentinel:** First verify the sentinel (confirms the claim is valid), then verify that the claim's ensures implies the requirement's ensures. Second check catches semantic mismatches.
- **Confidence gating:** Only use sentinels for predicate claims (where the ensures is an invariant conjunct and the semantic match is tight). Fall back to direct/LLM-guided for lemma claims where the ensures may not align.

## LLM sometimes omits required schema fields

**Status:** Worked around

The match step schema marks `matches`, `unexpected`, and `candidates` as required, but the LLM occasionally omits them. Both `src/main.js` and `test/integration/run-all-sentinel.js` use `??=` defaults to avoid crashes.
