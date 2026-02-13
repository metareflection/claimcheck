# Gotchas

## Lemma sentinels have the ensures backwards

**Status:** Open

Predicate sentinels and lemma sentinels use different patterns, but only the predicate pattern is correct.

### Predicate sentinels: correct (general → specific)

When a requirement matches an invariant conjunct, the sentinel derives the specific property from the general invariant:

```dafny
// "The counter is always non-negative" matches Inv conjunct m >= 0
lemma Sentinel_pred_Inv_0(m: D.Model)
  requires D.Inv(m)       // general
  ensures m >= 0           // specific — this IS the requirement
{}
```

The `ensures` is the claim content, which directly expresses the requirement. Dafny checks `Inv(m) ⟹ m >= 0`. This is sound.

### Lemma sentinels: backwards (just replays the lemma)

When a requirement matches a lemma, the sentinel copies the lemma's own postcondition into `ensures` and calls the lemma in the body:

```dafny
// "Granting to a non-existent subject is a no-op" matches StepPreservesInv
lemma Sentinel_StepPreservesInv(m: D.Model, a: D.Action)
  requires D.Inv(m)
  ensures D.Inv(Normalize(Apply(m, a)))   // ← the lemma's ensures, NOT the requirement
{
  D.StepPreservesInv(m, a);
}
```

This just re-proves the lemma. It says nothing about the requirement (which needs `Apply(m, Grant(s, c)) == m` when `s !in m.subjects`).

### What it should do

The same general → specific pattern as predicates. The `ensures` should express the **requirement**, and the matched lemma should be used in the **body** as a proof hint:

```dafny
lemma Sentinel_GrantToNonExistentIsNoOp(m: D.Model, s: Subject, c: Capability)
  requires D.Inv(m)
  requires s !in m.subjects
  ensures D.Apply(m, D.Grant(s, c)) == m    // ← the requirement
{
  D.StepPreservesInv(m, D.Grant(s, c));     // ← lemma as proof hint
}
```

Now Dafny checks whether StepPreservesInv actually helps prove the requirement — and if the match was wrong, the sentinel fails, which is the correct outcome.

### Where it shows up

- **delegation-auth:** Three no-op requirements all "proved" by the same `StepPreservesInv` sentinel (both Sonnet and Opus).
- **kanban (Opus):** "Moving a card preserves total card count" proved via `StepPreservesInv`. "Adding a card to a full column is a no-op" proved via the WIP limit predicate.
- **colorwheel (Opus):** Four of six requirements matched to `InitSatisfiesInv` — proving `Inv(Init())` instead of the actual properties in arbitrary states.
- **canon (Opus):** Two requirements matched to `InitSatisfiesInv`.

Opus is more aggressive at matching requirements to broad lemmas, making the problem worse — but the root cause is the sentinel construction, not the model.

### Fix

The lemma sentinel's `ensures` must come from formalizing the requirement (needs an LLM call), not from the matched lemma. The matched lemma moves to the proof body as a hint. This makes lemma sentinels no longer zero-LLM-cost, but they remain cheaper than the full direct/retry path because the proof body is mechanical.

## LLM sometimes omits required schema fields

**Status:** Worked around

The match step schema marks `matches`, `unexpected`, and `candidates` as required, but the LLM occasionally omits them. Both `src/main.js` and `test/integration/run-all-sentinel.js` use `??=` defaults to avoid crashes.
