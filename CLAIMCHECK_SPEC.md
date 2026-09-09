# Claimcheck: Two-Pass Algorithm Specification

## Input

An array of claims, each with:
- `requirement` — natural-language requirement
- `lemmaName` — name of the Dafny lemma
- `dafnyCode` — the lemma source (requires/ensures contract + proof body)

Plus a `domain` string used in prompts.

## Pass 1: Informalize (Haiku)

One batched API call. The model receives **only the Dafny code** — it does **not** see any requirements.

For each lemma, the model produces:

| Field | Type | Description |
|-------|------|-------------|
| `naturalLanguage` | string | English back-translation |
| `preconditions` | string | Requires clauses in English |
| `postcondition` | string | Ensures clauses in English |
| `scope` | string | Single state, transition, all reachable states, etc. |
| `strength` | enum | `trivial` / `weak` / `moderate` / `strong` |
| `confidence` | number | 0–1 |

Strength ratings:
- `trivial` — ensures restates requires, is a tautology, or follows trivially from definitions
- `weak` — says very little
- `moderate` — substantive claim
- `strong` — significantly constrains behavior

## Pre-Checks (Deterministic)

Between passes:
1. Log any lemma rated `trivial` strength
2. Log duplicate postconditions across different requirements

These are diagnostic warnings only — they do not affect the verdict.

## Pass 2: Compare (Sonnet)

One batched API call. For each claim, the model receives the original requirement, the back-translation from Pass 1 (including strength), and the Dafny code.

The model checks for:
1. **Tautology** — ensures restates requires
2. **Weakened postcondition** — ensures says less than the requirement
3. **Narrowed scope** — lemma covers a subset of cases
4. **Missing case** — requirement has multiple conditions, lemma captures some
5. **Wrong property** — lemma proves something different

Output per pair:

| Field | Type | Description |
|-------|------|-------------|
| `match` | boolean | Does the lemma faithfully express the requirement? |
| `discrepancy` | string | What's wrong (if `match` is false) |
| `weakeningType` | enum | `none` / `tautology` / `weakened-postcondition` / `narrowed-scope` / `missing-case` / `wrong-property` |
| `explanation` | string | Reasoning |
| `readings` | array | Every reasonable reading of the requirement, each as `{ reading, requires, ensures, covered }` — a Dafny contract over the lemma's parameters and whether the lemma is at least as strong as it. Exactly one entry for an unambiguous requirement |
| `nlAmbiguous` | boolean | True only if the verdict depends on which reading is taken |
| `interpretation` | string | The reading the lemma actually formalizes (when ambiguous) |

## Discharge (Optional, Dafny)

With `--discharge`, each reading is checked mechanically (`src/discharge.js`). For lemma `L` (`requires P_L; ensures Q_L`) and reading `R` (`requires P_R; ensures Q_R`), a wrapper lemma with R's contract whose body calls L verifies iff `P_R ⇒ P_L` and `P_R ∧ Q_L ⇒ Q_R`, i.e. L covers R.

| Probe | Harness | Verified means |
|-------|---------|----------------|
| `check` | R's contract, body `L(args);`, functions opaque | reading **covered** (proof) |
| `trivial` | R's contract, empty body, functions opaque | reading is **trivial** (excluded) |
| `sat` | `requires P_R; ensures false`, empty body, transparent | reading is **vacuous** (excluded) |

Opacity (`--default-function-opacity opaque`) is what makes `check` measure the lemma's *contract* rather than the domain: transparent, Dafny would prove any reading the invariant already implies, so a tautology lemma would cover everything. A failed `check` is **unknown**, not "uncovered", and the model's judgement for that reading stands.

## Verdict

Per pair, from `readings` (vacuous/trivial ones excluded) and the model's `match` (`src/ambiguity.js`):

- every reading covered, at least one by proof → **confirmed** (overrides a model dispute)
- some readings covered, others not → **ambiguous**
- otherwise → `match: true` → **confirmed**, `match: false` → **disputed**

`options.ambiguity` collapses **ambiguous**: `flag` (default, keep), `strict` (→ disputed), `lenient` (→ confirmed). Each result carries `evidence`: `proven` (all readings proven), `mixed`, or `judged`.

## Output

```json
{
  "results": [
    {
      "requirement": "...",
      "lemmaName": "...",
      "status": "confirmed | disputed | ambiguous | error",
      "dafnyCode": "...",
      "informalization": { ... },
      "comparison": { ... },
      "discrepancy": "...",
      "weakeningType": "...",
      "readings": [{ "reading": "...", "requires": "...", "ensures": "...", "covered": true, "evidence": "proven | judged | vacuous | trivial" }],
      "evidence": "proven | mixed | judged",
      "nlAmbiguous": true,
      "interpretation": "..."
    }
  ],
  "tokenUsage": { "input": 0, "output": 0 }
}
```

## Configuration

| Parameter | Default |
|-----------|---------|
| `informalizeModel` | `claude-haiku-4-5-20251001` |
| `compareModel` | `claude-sonnet-4-5-20250929` |
| `temperature` | `0` |

## Files

| File | Role |
|------|------|
| `src/claimcheck.js` | Pure JSON-in/JSON-out entry point |
| `src/roundtrip.js` | Two-pass implementation |
| `src/prompts.js` | LLM prompts for each step |
| `src/schemas.js` | Tool schemas (structured output) |
| `src/api.js` | Anthropic API wrapper |
| `src/audit.js` | Wrapper adding lemma extraction and Dafny verification |
| `src/extract.js` | Dafny lemma extraction by name |
| `src/verify.js` | Optional Dafny verification |
| `src/ambiguity.js` | Readings → status; ambiguity policy |
| `src/discharge.js` | Dafny harness that proves reading coverage |
