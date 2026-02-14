# Architecture

Claimcheck is an **audit tool** that answers: does a Dafny lemma actually mean what a requirement says? Dafny can verify proofs, but it can't verify meaning. Claimcheck fills that gap.

Someone else (Claude Code, a human, any agent) writes the lemmas and claims "requirement X is covered by lemma Y." Claimcheck verifies that claim via a round-trip: informalize the lemma back to English (without seeing the requirement), then compare.

---

## Input

1. **Requirements** — a markdown file, one requirement per line/bullet:
   ```markdown
   - The counter value is always non-negative
   - The initial state satisfies the invariant
   ```

2. **Mapping** — a JSON file linking each requirement to a lemma name:
   ```json
   [
     { "requirement": "The counter value is always non-negative", "lemmaName": "CounterNonNegative" },
     { "requirement": "The initial state satisfies the invariant", "lemmaName": "InitSatisfiesInv" }
   ]
   ```

3. **Claims source** — a `.dfy` file containing the requirement-level lemmas. Typically a separate file that `include`s the domain and defines `Inv(m) ==> X` style lemmas in its own module. The domain file itself usually only has structural lemmas (`InitSatisfiesInv`, `StepPreservesInv`); the claims file adds lemmas that connect the invariant to specific requirements.

---

## Audit Pipeline

Two modes are available:

### Two-pass mode (default)

```
1. Load requirements, mapping, .dfy source
2. For each mapping entry:
   a. Extract lemma from .dfy by name (ad-hoc parser)
   b. Optionally: dafny verify the lemma (confirm it's actually proved)
3. Batch informalize all lemmas (haiku, 1 LLM call) — does NOT see requirements
4. Batch compare back-translations against requirements (sonnet, 1 LLM call)
5. Report: which mappings are confirmed, which are disputed
```

Uses **structural separation**: different models for informalization and comparison, so the informalizer cannot be influenced by the NL requirement.

### Single-prompt mode (`--single-prompt`)

```
1. Load requirements, mapping, .dfy source
2. For each mapping entry:
   a. Extract lemma from .dfy by name
   b. Single LLM call per pair: informalize → compare → check vacuity → verdict
3. Report with richer output: verdict, vacuity check, surprising restrictions
```

Uses **prompt-level separation**: the model is instructed to informalize the lemma before reading the NL requirement, but both appear in the same prompt. Produces richer output (JUSTIFIED / PARTIALLY_JUSTIFIED / NOT_JUSTIFIED / VACUOUS verdicts).

### Why Round-Trip?

The fundamental problem: an LLM (or human) can write a Dafny lemma that Dafny proves, but that doesn't actually express the intended requirement. Common failure modes:

- **Tautology**: `requires m <= 100; ensures m <= 100` — ensures restates requires
- **Weakened postcondition**: requirement says "exactly 5 colors" but ensures says "at least 1 color"
- **Narrowed scope**: lemma only covers one case when requirement covers many
- **Wrong property**: lemma proves something related but different

Dafny happily proves all of these. The round-trip catches them.

**Two-pass mode** catches these by:

1. **Informalize** (haiku): read the Dafny code → produce English description. Does NOT see the original requirement. Rates strength (trivial/weak/moderate/strong).
2. **Compare** (sonnet): check original requirement vs back-translation. Strict — flags potential mismatches.

Using different models (haiku for informalization, sonnet for comparison) avoids same-model collusion.

**Single-prompt mode** catches these via a structured two-pass analysis within one prompt (informalize first, then compare, plus vacuity and restriction checks).

### Pre-checks (two-pass mode only)

Before comparison, automatic pre-checks flag:
- **Trivial strength**: informalization rated the lemma as trivially weak
- **Duplicate postconditions**: multiple lemmas with identical back-translated postconditions

---

## Output

For each mapping entry, one of:

| Status | Meaning |
|--------|---------|
| **confirmed** | Round-trip passed — lemma faithfully expresses the requirement |
| **disputed** | Round-trip failed — discrepancy between lemma meaning and requirement |
| **verify-failed** | Dafny verification failed (only with `--verify` flag) |
| **error** | Lemma not found in source |

Disputed mappings also get an `obligations.dfy` file with lemma stubs.

### Report Format

Markdown by default, JSON with `--json`. Shows:
- Summary: X confirmed, Y disputed, Z errors
- Confirmed mappings with lemma code and back-translation
- Disputed mappings with discrepancy detail and weakening type
- API token usage

---

## CLI

```
claimcheck [options]
  -r, --requirements <path>    Requirements file (markdown)
  -m, --mapping <path>         Mapping file (JSON)
  --dfy <path>                 Claims .dfy file (containing the lemmas)
  --module <name>              Dafny module name to import
  -d, --domain <name>          Human-readable domain name
  -o, --output <dir>           Output directory
  --json                       JSON output
  --verify                     Also run dafny verify on each lemma
  --single-prompt              Use single-prompt claimcheck mode (one call per pair)
  --model <id>                 Model for single-prompt mode (default: sonnet)
  --informalize-model <id>     Model for back-translation in two-pass mode (default: haiku)
  --compare-model <id>         Model for comparison in two-pass mode (default: sonnet)
  -v, --verbose                Verbose logging
```

---

## Soundness Checks

When `--verify` is used, lemmas are rejected before Dafny verification if they contain:
- **`assume` statements** — defeats the purpose of verification
- **`{:axiom}` attributes** — would make Dafny accept unproved claims

---

## Source Files

| File | Purpose |
|------|---------|
| main.js | CLI + orchestration |
| audit.js | audit pipeline: extract → verify → roundtrip → results |
| extract.js | extract lemma by name from .dfy source |
| roundtrip.js | round-trip check: two-pass (informalize → compare) and single-prompt modes |
| verify.js | wrap lemma in module, run `dafny verify` / `dafny resolve`, soundness checks |
| erase.js | strip lemma proof bodies, add {:axiom} (utility) |
| obligations.js | generate obligations.dfy for disputed mappings |
| report.js | markdown/JSON output |
| prompts.js | LLM prompts (informalize, compare, single-prompt claimcheck) |
| schemas.js | tool schemas for structured LLM output |
| api.js | Anthropic API wrapper |

---

## Open Issues

### Inherited contracts from module refinement

Domain lemmas like `StepPreservesInv` often inherit `requires Inv(m)` from an abstract module (e.g. the Replay kernel) via Dafny module refinement. The source text doesn't show the inherited precondition. When claimcheck extracts the lemma, the informalizer sees no `requires` clause and reads it as "holds for any model" rather than "preserves the invariant" — a correct reading of the literal text, but wrong about the actual contract.

**Workaround**: the claims file should state the complete contract explicitly, including inherited preconditions. The claims file is an assertion by the author about what the lemma means, not a copy of the source.

**Proper fix**: resolve the full contract by parsing the abstract module's specs, or by asking Dafny to emit resolved signatures. Neither is implemented.

### Informalizer lacks domain context

The informalize step (haiku) sees only the lemma code, not the domain source. When `Model` is a type alias (e.g. `type Model = int` in the counter domain), the informalizer doesn't know this. A lemma `ensures m >= 0` gets back-translated as "the model is non-negative" rather than "the counter value is non-negative," causing a false-positive dispute.

**Possible fix**: pass type definitions (datatypes, type aliases, predicates) to the informalize prompt as read-only context. This gives the LLM enough to understand what `Model`, `Inv`, etc. mean without seeing the original requirements (which must stay hidden for the round-trip to work). Tradeoff: more tokens, risk of leaking intent through naming.

### No coverage gap detection

Claimcheck only audits mappings that exist. If a requirement has no mapping entry, it's silently ignored. There's no report of "these requirements have no lemma covering them."

**Fix**: compare the mapping's requirement list against the full requirements file and report unmapped requirements.

### `--verify` with claims files

When `--dfy` points at a claims file (not the domain file), `verify.js` wraps the extracted lemma in a new module that `include`s the claims file and `import`s the domain module. This double-wrapping (claims module imports domain, verify module also imports domain) may cause Dafny resolution issues depending on module structure.

**Status**: not tested end-to-end. The `--verify` flag is opt-in.
