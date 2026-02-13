# Architecture

Claimcheck answers: **does a formally verified Dafny specification cover a set of informal user requirements?**

Two pipelines exist: a **top-down** pipeline (requirements → lemmas → proof) and **bottom-up** modules (source → claims → English → coverage). They complement each other: top-down generates and verifies new lemmas, bottom-up analyzes what existing verified code already covers.

The top-down pipeline has three phases: formalize, round-trip verify, and prove. The round-trip check catches LLM cheating (tautologies, weakened ensures) that Dafny can't detect.

---

## Input

- **Requirements**: a list of informal statements (markdown, one per line or bullet)
- **Domain source**: the `.dfy` file containing Model, Inv, Apply, Normalize, etc.

---

## Top-Down Pipeline

```
Phase 1 — Formalize (batch)
    1. LLM sees erased source + ALL requirements → lemma signatures (empty body)
    2. dafny resolve → typecheck all signatures
    3. If resolve fails → resolve individually, retry broken ones, obligation if still broken

Round-Trip Check (NEW)
    4. Informalize: different LLM (haiku) reads each lemma → English back-translation
       (does NOT see original requirements)
    5. Compare: LLM (sonnet) checks original requirement vs back-translation
    6. Mismatch → re-formalize with discrepancy feedback, re-resolve, re-check
       Still mismatch → obligation (strategy: roundtrip-fail)

Phase 1 continued
    7. dafny verify with empty bodies (only round-trip-passed lemmas)

Phase 2 — Prove (individual, only for lemmas that need proof)
    8. LLM sees domain source + well-typed signature + verify error → writes proof body
    9. dafny verify → if fails, retry once → obligation
```

### Why Round-Trip?

The fundamental flaw of the top-down pipeline is that the LLM writes Dafny `ensures` clauses, and Dafny can't tell if they faithfully express the English requirement. The LLM can cheat:
- **Tautology**: `requires m <= 100; ensures m <= 100` — ensures restates requires
- **Weakened ensures**: requirement says "exactly 5 colors" but ensures says "at least 1 color"
- **Narrowed scope**: lemma only covers one case when requirement covers many
- **Wrong property**: lemma proves something related but different

Dafny happily proves all of these. The round-trip check catches them by informalizing the Dafny code back to English (with a different model that hasn't seen the requirements), then comparing.

### Source Preparation

Lemma proof bodies are erased and marked `{:axiom}` for Phase 1. This gives the LLM a clean view: all types, functions, predicates, and lemma signatures are preserved, but proof noise is stripped.

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

The LLM receives erased domain source and **all** requirements at once. It produces one lemma signature per requirement, each with an empty body `{}`.

All signatures are batch-resolved with `dafny resolve` (fast — no Z3). If the batch fails, each lemma is resolved individually. Failing ones are retried (one LLM call with the resolution errors), then re-resolved. Still broken = obligation.

### Round-Trip Check

After resolution, ALL resolved lemmas go through the round-trip check:

1. **Informalize** (haiku, one batch call): reads each lemma and produces structured English — preconditions, postconditions, scope, strength rating. Does NOT see original requirements.
2. **Pre-checks**: auto-flag trivial-strength informalizations and duplicate postconditions across different requirements.
3. **Compare** (sonnet, one batch call): checks original requirement vs back-translation. Lists cheating patterns to watch for. Strict — better to flag than miss.
4. **On mismatch**: re-formalize with discrepancy feedback (one sonnet call), re-resolve, re-check. Still failing = obligation with `strategy: roundtrip-fail`.

Using haiku for informalization and sonnet for comparison avoids same-model collusion. The structured informalization schema (separate preconditions/postconditions/strength) makes tautologies obvious.

Cost: +2 API calls on clean run (~$0.03). +3 more on retry. Negligible vs existing pipeline.

### Phase 2: Write Proofs

For lemmas that resolved and passed round-trip but didn't verify with an empty body, the LLM writes a proof body. It receives:
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
| `roundtrip-fail` | RT | Lemma didn't faithfully express requirement |

### Obligation

If a lemma fails round-trip (even after re-formalization), or Phase 2 retry also fails, the requirement becomes an obligation — a Dafny lemma stub with the error and best attempt.

### Error Attribution

When batch resolve fails, each lemma is resolved individually rather than parsing Dafny error output. `dafny resolve` is fast (no Z3), so N individual calls is fine. Each failing lemma gets its own clean error message for the retry prompt.

---

## Bottom-Up Modules

The bottom-up pipeline analyzes existing verified Dafny code to determine what requirements it already covers, without generating new lemmas. It consists of three steps:

### flatten.js — Claim Extraction

Pure data transform, no LLM. Splits a Dafny source file into flat claims:
- Invariant conjuncts (from `predicate Inv`)
- Lemma ensures clauses (split on `&&`)
- Function/predicate contracts
- Axiom ensures clauses

Each claim gets a structured ID (e.g., `Module.LemmaName.ensures.0`).

### translate.js — Formal→NL Translation

Batched LLM calls (haiku, batches of 10). Translates each Dafny expression to plain English with a confidence score.

### compare.js — Coverage Analysis

Single LLM call (sonnet). Matches translated claims against requirements text. Produces:
- **proved**: requirements covered by formal claims
- **missing**: requirements with no formal backing
- **unexpected**: formal claims not matching any requirement
- **summary**: overall coverage assessment

### How They Complement Each Other

The top-down pipeline is **generative**: it writes new lemmas to cover requirements. The bottom-up pipeline is **analytical**: it reads existing code to see what's already covered.

Use top-down when you want to verify a new spec against requirements. Use bottom-up when you want to audit an existing verified codebase. The lemmafit dashboard imports both.

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
- **obligation**: the best attempt + Dafny error (with discrepancy for round-trip failures)

The report shows which requirements are formally verified and which need manual proof. An `obligations.dfy` file is generated with lemma stubs for gaps.

---

## Source Files

| File | Purpose |
|------|---------|
| main.js | CLI + orchestration |
| prove.js | three-phase pipeline: batch formalize → round-trip → verify → prove |
| roundtrip.js | round-trip check: informalize → compare → re-formalize |
| verify.js | wrap lemma in module, run `dafny verify` / `dafny resolve`, soundness checks |
| erase.js | strip lemma proof bodies, add {:axiom} |
| flatten.js | mechanical claim extraction (bottom-up) |
| translate.js | formal→NL batch translation (bottom-up) |
| compare.js | NL claim↔requirement matching (bottom-up) |
| obligations.js | generate obligations.dfy |
| report.js | markdown/JSON output |
| prompts.js | all LLM prompts (formalize, round-trip, proof, translate, compare) |
| schemas.js | tool schemas for structured LLM output |
| api.js | Anthropic API wrapper (with configurable maxTokens) |
