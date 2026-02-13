# claimcheck

Check user requirements against formally verified Dafny claims. Uses sentinel proofs to formally confirm matches, and generates proof obligations for anything that can't be automatically discharged.

## Pipeline

1. **Flatten** — normalize `dafny2js --claims` JSON into individual claim items
2. **Translate** — convert each formal claim to natural language (Haiku)
3. **Match** — identify candidate claim-requirement matches with confidence scores (Sonnet)
4. **Prove** — for every requirement, try to formally verify it via strategy escalation:
   - **Sentinel** — if a candidate match exists, construct a proof that calls the matched lemma (zero LLM cost)
   - **Direct** — formalize the requirement with an empty proof body
   - **LLM-guided** — have Sonnet write the proof
   - **Retry** — feed Dafny errors back for iterative refinement
5. **Obligations** — write `obligations.dfy` for requirements that couldn't be proved

## Usage

```bash
# Full pipeline with verification
node bin/claimcheck.js \
  -c claims.json \
  -r requirements.md \
  --module CounterDomain -d Counter \
  --dfy ../dafny-replay/counter/CounterDomain.dfy

# Requirements matching only (no Dafny verification)
node bin/claimcheck.js \
  -c claims.json \
  -r requirements.md \
  --module CounterDomain -d Counter

# Extract claims from Dafny source first
node bin/claimcheck.js \
  --extract --dafny2js ../dafny-replay/dafny2js \
  --dfy ../dafny-replay/counter/CounterDomain.dfy \
  -r requirements.md \
  --module CounterDomain -d Counter

# JSON output
node bin/claimcheck.js -c claims.json -r requirements.md --module CounterDomain --json
```

## Options

| Flag | Description |
|------|-------------|
| `-c, --claims <path>` | Path to claims.json (from `dafny2js --claims`) |
| `-r, --requirements <path>` | Path to requirements file (markdown) |
| `--dfy <path>` | Path to domain .dfy file (enables verification) |
| `--module <name>` | Dafny module name to filter claims to |
| `-d, --domain <name>` | Human-readable domain name for prompts |
| `-o, --output <dir>` | Output directory for obligations.dfy (default: `.`) |
| `--retries <n>` | Max verification retries per requirement (default: 3) |
| `--extract` | Run `dafny2js --claims` first (requires `--dafny2js`) |
| `--dafny2js <path>` | Path to dafny2js project directory |
| `--json` | Output JSON instead of markdown |
| `-v, --verbose` | Verbose API/verification logging |

## Output

**Markdown report** with sections:
- Formally Verified Requirements — grouped by strategy (sentinel, direct, LLM-guided)
- Obligations — requirements that need manual proof (see `obligations.dfy`)
- Unexpected Proofs — claims with no corresponding requirement

**obligations.dfy** — a Dafny module with lemma stubs for each unproved requirement, including the strategy trail and best attempt:

```dafny
include "../dafny-replay/counter/CounterDomain.dfy"

module Obligations {
  import D = CounterDomain

  // Requirement: "The counter never exceeds 100"
  // Status: unproven after 4 attempt(s)
  // Strategies: sentinel✗ → direct✗ → llm-guided✗ → retry✗
  lemma CounterNeverExceeds100(m: D.Model)
    requires D.Inv(m)
    ensures m <= 100
  { /* OBLIGATION */ }
}
```

## Requirements

- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable
- `dafny` in PATH (for verification step)
- [dafny-replay/dafny2js](../dafny-replay/dafny2js) (for `--extract` mode)

## Tests

```bash
# Unit tests
node --test test/flatten.test.js

# Integration suite: extract claims from all dafny-replay projects + flatten
./test/integration/run-suite.sh

# Full pipeline on a specific project (needs ANTHROPIC_API_KEY + dafny)
./test/integration/run-suite.sh --full counter
```

## Evaluation

See [EVAL.md](EVAL.md) for the promptfoo-based evaluation framework that compares model combinations across 5 test domains.

```bash
npm run eval           # run default eval
npm run eval:ab        # A/B model comparison
npm run eval:view      # open web UI
```
