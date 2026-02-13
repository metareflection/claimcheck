# Architecture

Claimcheck answers: **does a formally verified Dafny specification cover a set of informal user requirements?**

A two-phase pipeline separates formalization (getting types right) from proof (filling in proof bodies). Phase 1 batches all requirements in one LLM call. Phase 2 only runs for lemmas that don't verify with an empty body.

---

## Input

- **Requirements**: a list of informal statements (markdown, one per line or bullet)
- **Domain source**: the `.dfy` file containing Model, Inv, Apply, Normalize, etc.

No claims extraction. No NL translation. No matching. The LLM reads the source directly.

---

## Pipeline

```
Phase 1 — Formalize (batch)
    1. LLM sees erased source + ALL requirements → produces lemma signatures (empty body)
    2. dafny resolve → typechecks all signatures at once
    3. If resolve fails → resolve individually, retry broken ones, obligation if still broken
    4. dafny verify with empty bodies → many lemmas pass here (done!)

Phase 2 — Prove (individual, only for lemmas that need proof)
    5. LLM sees domain source + well-typed signature + verify error → writes proof body
    6. dafny verify → if fails, retry once → obligation
```

Best case (e.g. counter): 1 LLM call + 1 resolve + 1 verify = done. Most invariant-consequence lemmas verify with an empty body.

Worst case: 1 batch LLM call + N individual resolves + retry LLM call + verify + M proof LLM calls + M retries.

### Source Preparation

Lemma proof bodies are erased and marked `{:axiom}` for Phase 1. This gives the LLM a clean view: all types, functions, predicates, and lemma signatures are preserved, but proof noise is stripped. The LLM knows what's already proved (from `ensures` clauses) without being distracted by proof internals.

```dafny
// Before (raw source)
lemma StepPreservesInv(m: Model, a: Action)
  requires Inv(m)
  ensures Inv(Normalize(Apply(m, a)))
{
  NormalizePreservesInv(m, a);
  // ... proof details ...
}

// After (what the LLM sees in Phase 1)
lemma {:axiom} StepPreservesInv(m: Model, a: Action)
  requires Inv(m)
  ensures Inv(Normalize(Apply(m, a)))
{
}
```

Phase 2 uses the full source by default (the LLM needs to see proof patterns to write proofs). The `--erase` flag makes Phase 2 also use erased source.

### Phase 1: Batch Formalize

The LLM receives erased domain source and **all** requirements at once. It produces one lemma signature per requirement, each with an empty body `{}`:

```dafny
lemma CounterNonNegative(m: D.Model)
  requires D.Inv(m)
  ensures m >= 0
{}
```

All signatures are batch-resolved with `dafny resolve` (fast — no Z3). If the batch fails, each lemma is resolved individually. Failing ones are retried (one LLM call with the resolution errors), then re-resolved. Still broken = obligation.

Resolved signatures are then batch-verified with `dafny verify`. Many pass here (invariant consequences verify with an empty body). Failing ones are verified individually to separate passes from failures.

### Phase 2: Write Proofs

For lemmas that resolved but didn't verify with an empty body, the LLM writes a proof body. It receives:
- The full domain source (or erased with `--erase`)
- The well-typed signature
- The Dafny verification error

It keeps the requires/ensures clauses and fills in the body. One retry on failure.

### Strategies

| Strategy | Phase | Description |
|----------|-------|-------------|
| `direct` | 1 | Verified with empty body |
| `proof` | 2 | LLM wrote a proof body |
| `proof-retry` | 2 | LLM fixed a failed proof on retry |

### Obligation

If Phase 2 retry also fails, the requirement becomes an obligation — a Dafny lemma stub with the error and best attempt.

### Error Attribution

When batch resolve fails, each lemma is resolved individually rather than parsing Dafny error output. `dafny resolve` is fast (no Z3), so N individual calls is fine. Each failing lemma gets its own clean error message for the retry prompt.

---

## Soundness Checks

Generated lemmas are rejected before Dafny verification if they contain:

- **`assume` statements** — defeats the purpose of verification
- **`{:axiom}` attributes** — would make Dafny accept unproved claims

Additionally, `--allow-warnings` is not passed to Dafny, so warnings are treated as failures.

---

## Output

For each requirement:
- **proved**: the verified Dafny lemma + reasoning
- **obligation**: the best attempt + Dafny error

The report shows which requirements are formally verified and which need manual proof. An `obligations.dfy` file is generated with lemma stubs for gaps.

---

## Source Files

| File | Purpose |
|------|---------|
| main.js | CLI + orchestration |
| prove.js | two-phase pipeline: batch formalize → resolve → verify → prove |
| verify.js | wrap lemma in module, run `dafny verify` / `dafny resolve`, soundness checks |
| erase.js | strip lemma proof bodies, add {:axiom} |
| obligations.js | generate obligations.dfy |
| report.js | markdown/JSON output |
| prompts.js | batch formalize, resolution retry, proof, proof retry prompts |
| schemas.js | formalize tool + batch formalize tool schemas |
| api.js | Anthropic API wrapper (with configurable maxTokens) |
