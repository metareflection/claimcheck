# Architecture

Claimcheck answers: **does a formally verified Dafny specification cover a set of informal user requirements?**

For each requirement, it formalizes a Dafny lemma and asks the theorem prover to verify it. Two attempts, then an obligation.

---

## Input

- **Requirements**: a list of informal statements (markdown, one per line or bullet)
- **Domain source**: the `.dfy` file containing Model, Inv, Apply, Normalize, etc.

No claims extraction. No NL translation. No matching. The LLM reads the source directly.

---

## Pipeline

```
for each requirement:
    1. Formalize   LLM writes a Dafny lemma from the requirement + domain source
    2. Verify      Dafny checks it (with soundness checks)
    3. If failed:  LLM retries once with the Dafny error
    4. If failed:  emit as obligation
```

Two LLM calls and two Dafny calls, max. Per requirement.

### Source Preparation

Before the LLM sees the domain source, lemma proof bodies are erased and marked `{:axiom}`. This gives the LLM a clean view: all types, functions, predicates, and lemma signatures are preserved, but proof noise is stripped. The LLM knows what's already proved (from `ensures` clauses) without being distracted by proof internals.

```dafny
// Before (raw source)
lemma StepPreservesInv(m: Model, a: Action)
  requires Inv(m)
  ensures Inv(Normalize(Apply(m, a)))
{
  NormalizePreservesInv(m, a);
  // ... proof details ...
}

// After (what the LLM sees)
lemma {:axiom} StepPreservesInv(m: Model, a: Action)
  requires Inv(m)
  ensures Inv(Normalize(Apply(m, a)))
{
}
```

### Formalize

The LLM receives the erased domain source and the requirement text. It writes a lemma placed in a module that imports the domain as `D`:

```dafny
lemma Req_CounterNonNegative(m: D.Model)
  requires D.Inv(m)
  ensures m >= 0
{}
```

### Verify

The lemma is wrapped in a module that imports the domain:

```dafny
include "path/to/Domain.dfy"
module VerifyRequirement {
  import opened D = DomainModule
  <lemma>
}
```

Dafny verifies it against the **original** source (with full proofs). Before running Dafny, the lemma is checked for soundness: `assume` statements and `{:axiom}` attributes are rejected.

### Retry

The LLM receives the failed lemma and the Dafny error. It fixes types, adds proof hints, or restructures. One chance.

### Obligation

If both attempts fail, the requirement becomes an obligation — a Dafny lemma stub with the error and best attempt.

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
| prove.js | formalize -> verify -> retry -> obligation |
| verify.js | wrap lemma in module, run Dafny, soundness checks |
| erase.js | strip lemma proof bodies, add {:axiom} |
| obligations.js | generate obligations.dfy |
| report.js | markdown/JSON output |
| prompts.js | formalize + retry prompts |
| schemas.js | formalize tool schema |
| api.js | Anthropic API wrapper |
