# New Architecture: Claimcheck v2

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
    2. Verify      Dafny checks it
    3. If failed:  LLM retries once with the Dafny error
    4. If failed:  emit as obligation
```

That's it. Two LLM calls and two Dafny calls, max. Per requirement.

### Formalize

The LLM receives:
- the full domain source code
- the requirement text

It writes a lemma:

```dafny
lemma Req_CounterNonNegative(m: D.Model)
  requires D.Inv(m)
  ensures m >= 0
{}
```

The `ensures` expresses the requirement. The `requires` includes `Inv(m)` for state properties, plus any additional preconditions for behavioral properties. The body is empty if possible, or calls existing domain lemmas as proof steps.

### Verify

The lemma is wrapped in a module that imports the domain:

```dafny
include "path/to/Domain.dfy"
module VerifyRequirement {
  import opened D = DomainModule
  <lemma>
}
```

Dafny verifies it. Success → proved. Failure → one retry.

### Retry

The LLM receives the failed lemma and the Dafny error. It fixes types, adds proof hints, or restructures. One chance.

### Obligation

If both attempts fail, the requirement becomes an obligation — a commented Dafny lemma with the error and best attempt. Obligations are the interface to more powerful systems:

- A stronger model (Opus)
- A dedicated proof agent with longer context
- Manual human guidance
- A sentinel library (per PROPOSAL.md) that provides reusable proof building blocks

Obligations are starting points, not dead ends.

---

## Output

For each requirement:
- **proved**: the verified Dafny lemma + reasoning
- **obligation**: the best attempt + Dafny error + what seems to be missing

The report shows:
- Which requirements are formally verified (with the lemma code)
- Which are obligations (with the failure details)

No "unexpected proofs" section — that requires knowing what the spec contains independently, which is a separate analysis.

---

## What This Eliminates

From the current pipeline:

| Removed | Why |
|---------|-----|
| dafny2js --claims | LLM reads source directly |
| flatten.js | No claims to flatten |
| translate.js | No claims to translate |
| match.js | No NL matching needed |
| sentinel.js | No hint construction needed |
| extract.js | No extraction step |

What remains:

| Kept | Purpose |
|------|---------|
| main.js | CLI + orchestration (simplified) |
| prove.js | formalize → verify → retry → obligation |
| verify.js | wrap lemma in module, run Dafny |
| obligations.js | generate obligations.dfy |
| report.js | markdown/JSON output (simplified) |
| prompts.js | formalize + retry prompts (simplified) |
| schemas.js | formalize tool schema |
| api.js | Anthropic API wrapper |

---

## The Formalize Prompt

The prompt gives the LLM everything it needs:

1. The full domain source code (Inv definition, Apply, Normalize, all helper lemmas)
2. The requirement text
3. Instructions: write `ensures` from the requirement, try empty body first, call existing lemmas if needed

The domain source IS the context. The LLM can see every invariant conjunct, every helper lemma, every function contract. No need to extract and reformat this information.

---

## Two Kinds of Requirements (Still Relevant)

The classification from PROPOSAL.md still applies, but the LLM handles it implicitly:

**Inv-consequence** ("the counter is always non-negative"):
```dafny
lemma Req(m: D.Model)
  requires D.Inv(m)
  ensures m >= 0
{}  // empty body — Dafny unfolds Inv
```

**Anything** ("decrementing at zero is a no-op"):
```dafny
lemma Req(m: D.Model)
  requires D.Inv(m)
  requires m == 0
  ensures D.Normalize(D.Apply(m, D.Dec)) == 0
{}  // empty body — Dafny unfolds Apply + Normalize
```

**Anything with proof** ("every action preserves the invariant"):
```dafny
lemma Req(m: D.Model, a: D.Action)
  requires D.Inv(m)
  ensures D.Inv(D.Normalize(D.Apply(m, a)))
{
  D.StepPreservesInv(m, a);  // calls existing lemma
}
```

The LLM figures out which shape to use from the requirement text and the source code.

---

## Growth Path

This minimal pipeline is the foundation. Future additions layer on top:

**Obligation solver**: A more powerful agent (Opus, longer context, multi-turn) that takes obligations and tries harder — exploring the domain source, trying multiple proof strategies, proposing new helper lemmas.

**Coverage analysis**: A separate pass that extracts claims and identifies what the spec proves beyond the stated requirements ("unexpected proofs"). Useful but orthogonal to requirement verification.

**Batch mode**: Prove all requirements in parallel. Each is independent.

---

## Implementation Effort

This is a simplification of the existing codebase, not a rewrite:

- `main.js`: remove extract/flatten/translate/match steps, parse requirements directly
- `prove.js`: remove hint collection, simplify to formalize → verify → retry → obligation
- `prompts.js`: keep FORMALIZE_PROMPT and RETRY_PROMPT, remove TRANSLATE/MATCH/COMPARE prompts
- `report.js`: remove sentinel/match-related output
- `verify.js`: unchanged
- `obligations.js`: unchanged
- `schemas.js`: keep FORMALIZE_TOOL, remove others
- `api.js`: unchanged
- Delete: `flatten.js`, `translate.js`, `match.js`, `sentinel.js`, `extract.js`, `compare.js`
