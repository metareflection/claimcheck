# Architecture: Claimcheck

Claimcheck answers the question: **does a formally verified Dafny specification cover a set of informal user requirements?**

It does this by turning each requirement into a Dafny lemma and asking the theorem prover to verify it. The prover is the judge, not the LLM.

---

## The Domain Model

Claimcheck assumes the codebase follows the dafny-replay pattern:

- A `datatype Model` representing application state
- A predicate `Inv(m: Model)` — a conjunction of clauses characterizing all valid states
- A function `Apply(m: Model, a: Action): Model` defining state transitions
- A function `Normalize(m: Model): Model` clamping results back into valid range
- A lemma `InitSatisfiesInv()` proving the initial state is valid
- A lemma `StepPreservesInv(m, a)` proving every transition preserves the invariant

The invariant is the central specification. It holds for initial states, is preserved by all transitions, and implies many facts about the representation. Any reachable state satisfies `Inv`.

---

## Two Kinds of Requirements

### Inv-consequence ("what's true of valid states")

Most requirements are properties of a single state:

- "The counter is always non-negative"
- "Column names are unique"
- "All edge endpoints reference existing nodes"
- "The card allocator is always fresh"

These become lemmas of the form:

```dafny
lemma Req(m: D.Model)
  requires D.Inv(m)
  ensures P(m)
{}
```

The invariant is rich. `P(m)` might be a direct conjunct of `Inv`, or it might be an arbitrary logical consequence — the prover handles both. Many of these verify with an empty body because Dafny unfolds the invariant definition automatically.

### Anything else ("behavioral, transitional, relational")

Some requirements are about what actions do, not just what's true of states:

- "Decrementing at zero keeps the counter at zero"
- "Granting a capability to a non-existent subject is a no-op"
- "Every action preserves the invariant after normalization"
- "Moving a card preserves the total number of cards"

These become lemmas with richer signatures:

```dafny
lemma Req(m: D.Model, ...)
  requires D.Inv(m)
  requires <additional preconditions>
  ensures <property involving Apply, Normalize, etc.>
{
  // may need proof body: lemma calls, asserts
}
```

The invariant still provides the precondition, but the `ensures` involves function behavior, post-states, or relationships between states. These often need proof hints — calls to existing lemmas like `StepPreservesInv` or domain-specific helpers like `FlatColsUnique`.

---

## Pipeline

```
Requirements (NL)          Dafny Domain
       |                        |
       |                   [ Extract ]  dafny2js --claims
       |                        |
       |                   [ Flatten ]  split predicates into conjuncts,
       |                        |       lemmas into ensures clauses
       |                        |
       |                   [ Translate ] Dafny -> NL (Haiku, batched)
       |                        |
       +------------+-----------+
                    |
              [   Match   ]  NL similarity -> candidate hints (Sonnet)
                    |
                    |  { requirement, candidates[] }
                    |
              [   Prove   ]  for every requirement:
                    |          1. collect hints from candidates
                    |          2. LLM formalizes ensures from requirement
                    |          3. Dafny verifies
                    |          4. retry with error feedback if needed
                    |
              [ Obligations ] unproved requirements -> obligations.dfy
                    |
              [  Report   ]  markdown or JSON coverage report
```

### Step 1: Extract + Flatten

`dafny2js --claims` extracts predicates, lemmas, functions, and axioms from the Dafny source. Flatten decomposes these into individual items:

- Predicate conjuncts: `Inv(m)` is split into its AND-ed clauses, each becoming a `pred:Module.Inv:N` item
- Lemma ensures: each `ensures` clause becomes a `lemma:Module.Name:ensures:N` item
- Function contracts: `requires` and `ensures` become separate items

### Step 2: Translate

Each formal item is translated to natural language by Haiku (batched, cheap). This enables NL matching against requirements.

### Step 3: Match

Sonnet compares translated claims against requirements and produces candidate hints — not verdicts. Each requirement gets a ranked list of claims that might be related, with confidence scores and explanations.

The match step is deliberately permissive: it's better to suggest a wrong match (the prover will reject it) than to miss a correct one.

### Step 4: Prove

For each requirement, the prover:

1. **Collects hints** from matched candidates. Invariant conjuncts, proved lemmas, and function contracts are formatted as text descriptions for the LLM.

2. **Formalizes** the requirement. The LLM writes a Dafny lemma where:
   - The `ensures` expresses the requirement (not a hint's formal text)
   - The `requires` includes `Inv(m)` for state properties
   - The body is empty if possible, or uses hint lemmas as proof steps

3. **Verifies** via Dafny. The lemma is wrapped in a module that imports the domain and compiled.

4. **Retries** on failure. The Dafny error is fed back to the LLM, which fixes types, adds proof hints, or restructures the lemma. Up to 3 retries.

The strategy trail is recorded: `direct` (first attempt works) -> `llm-guided` (first retry works) -> `retry` (subsequent retries).

### Step 5: Obligations

Requirements that fail all attempts become obligations — commented Dafny lemmas written to `obligations.dfy` with the last error and best attempt. These are starting points for manual proof, not dead ends.

### Step 6: Report

Markdown or JSON output showing:
- Which requirements were formally verified (with strategy and code)
- Which became obligations (with failure details)
- Which proved claims don't match any requirement (unexpected)

---

## Hints, Not Sentinels

Matched claims are never used as the `ensures` clause. They are **context** for the LLM:

- **Invariant conjuncts** tell the LLM what `Inv(m)` contains, helping it write `P(m)` correctly
- **Proved lemmas** can be called in the proof body (e.g., `D.StepPreservesInv(m, a)`)
- **Function contracts** provide context about preconditions and postconditions

This avoids a class of false positives where a matched claim is confirmed (trivially true as an invariant conjunct or tautologically re-proved as a lemma) without actually proving the requirement.

The `ensures` always comes from formalizing the requirement. Dafny checks whether it actually follows.

---

## What's Not Here Yet

Per PROPOSAL.md, the full vision includes:

**Classification.** The system should decide whether a requirement is Inv-consequence or Anything and route accordingly. Currently all requirements go through the same formalization path.

**Richer hint retrieval.** Beyond NL-matched candidates, the system should retrieve helper lemmas by symbol overlap, goal head-shape, and arity matching. Currently hints come only from the match step.

**Sentinel library.** A curated layer of reusable `Inv(m) ==> DerivedFact(m)` lemmas that requirement proofs call instead of unfolding internals. Currently the domain's own helper lemmas serve this role informally.

**Productive gap reports.** When a proof fails, the system should propose what helper theorem is missing — growing the sentinel layer. Currently gaps just report the Dafny error.

**Autoformalization + informalization loop.** Bidirectional alignment between informal requirement text and formal lemma statements, supporting review by non-experts and traceability.

---

## Module Map

```
src/
  main.js        CLI entry + pipeline orchestration
  extract.js     run dafny2js --claims
  flatten.js     claims JSON -> individual items (conjuncts, ensures, contracts)
  translate.js   formal items -> NL (Haiku, batched)
  match.js       NL similarity -> candidate hints (Sonnet)
  sentinel.js    build hint text from matched claims
  prove.js       formalize + verify + retry loop
  verify.js      write temp Dafny module, run dafny verify
  obligations.js generate obligations.dfy for gaps
  report.js      markdown/JSON output
  prompts.js     all LLM prompt templates
  schemas.js     tool-use schemas for structured LLM responses
  api.js         Anthropic API wrapper + token tracking
```
