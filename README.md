# claimcheck

Check user requirements against formally verified Dafny claims. Extracts proof obligations for anything that can't be automatically discharged.

## Pipeline

1. **Flatten** — normalize `dafny2js --claims` JSON into individual claim items
2. **Translate** — convert each formal claim to natural language (Haiku)
3. **Compare** — match requirements against translated claims (Sonnet)
4. **Prove** — for unmatched requirements, generate a Dafny lemma and verify it (up to 3 retries)
5. **Obligations** — write `obligations.dfy` for requirements that couldn't be proved

## Usage

```bash
# Requirements only (no verification)
claimcheck \
  -c claims.json \
  -r requirements.md \
  --module CounterDomain -d Counter

# Full pipeline with verification
claimcheck \
  -c claims.json \
  -r requirements.md \
  --module CounterDomain -d Counter \
  --dfy ../dafny-replay/counter/CounterDomain.dfy

# Extract claims from Dafny source first
claimcheck \
  --extract --dafny2js ../dafny-replay/dafny2js \
  --dfy ../dafny-replay/counter/CounterDomain.dfy \
  -r requirements.md \
  --module CounterDomain -d Counter

# JSON output (for daemon/dashboard integration)
claimcheck -c claims.json -r requirements.md --module CounterDomain --json
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
- Proved and Matched — claims that cover a requirement
- Verified by Generated Lemma — requirements proved by auto-generated lemmas
- Obligations — requirements that need manual proof (see `obligations.dfy`)
- Unexpected Proofs — claims with no corresponding requirement

**obligations.dfy** — a Dafny module that includes the domain and contains lemma stubs for each unproved requirement:

```dafny
include "../dafny-replay/counter/CounterDomain.dfy"

module Obligations {
  import D = CounterDomain

  // Requirement: "The counter never exceeds 100"
  // Status: unproven after 3 attempt(s)
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

## dafny2js --claims

claimcheck's input is the JSON produced by `dafny2js --claims` from the [dafny-replay](../dafny-replay) repo. This section explains how to set it up and what it produces.

### Setup

```bash
# 1. Install Dafny (4.x)
#    See https://github.com/dafny-lang/dafny/wiki/INSTALL
dafny --version

# 2. Install .NET 8 SDK
#    See https://dotnet.microsoft.com/download
dotnet --version

# 3. Clone the Dafny compiler source (dafny2js links against it for AST parsing)
cd ../dafny-replay/dafny2js
#    If dafny/ subdir doesn't exist yet:
git clone --depth 1 https://github.com/dafny-lang/dafny.git dafny

# 4. Build dafny2js
dotnet build
```

### Running

```bash
cd ../dafny-replay/dafny2js

# Basic: prints claims JSON to stdout
dotnet run --no-build -- --file ../counter/CounterDomain.dfy --claims

# Save to file
dotnet run --no-build -- \
  --file ../counter/CounterDomain.dfy \
  --claims \
  --claims-output /tmp/counter-claims.json
```

The `--file` flag takes the entry .dfy file. Dafny resolves `include` directives transitively, so for multi-file projects you only need the root file — all modules from included files are extracted.

### What it extracts

dafny2js parses the Dafny AST and extracts four kinds of claims:

**Predicates** — invariants and ghost predicates. Compound predicates (joined by `&&`) are split into individual conjuncts:

```json
{
  "name": "Inv",
  "module": "CounterDomain",
  "body": "m >= 0",
  "conjuncts": ["m >= 0"],
  "line": 8,
  "isGhost": false
}
```

**Lemmas** — proved theorems with requires/ensures contracts:

```json
{
  "name": "StepPreservesInv",
  "module": "CounterDomain",
  "requires": ["Inv(m)"],
  "ensures": ["Inv(Normalize(Apply(m, a)))"],
  "line": 31
}
```

**Functions** — functions with requires/ensures contracts:

```json
{
  "name": "Apply",
  "module": "CounterDomain",
  "requires": ["Inv(m)"],
  "ensures": [],
  "line": 16
}
```

**Axioms** — unproved assumptions (`assume {:axiom}` statements or `{:axiom}` lemmas):

```json
{
  "content": "assume {:axiom} x > 0",
  "file": "/path/to/Domain.dfy",
  "module": "SomeDomain",
  "line": 42
}
```

### Example projects in dafny-replay

| Project | Entry file | Domain module | Preds | Conjuncts | Lemmas | Fns |
|---------|-----------|---------------|-------|-----------|--------|-----|
| `counter` | `CounterDomain.dfy` | `CounterDomain` | 3/5 | 7 | 30 | 10 |
| `kanban` | `KanbanDomain.dfy` | `KanbanDomain` | 5/7 | 16 | 81 | 13 |
| `colorwheel` | `ColorWheelDomain.dfy` | `ColorWheelDomain` | 10/12 | 23 | 56 | 21 |
| `canon` | `CanonDomain.dfy` | `CanonDomain` | 15/17 | 21 | 51 | 35 |
| `delegation-auth` | `DelegationAuthDomain.dfy` | `DelegationAuthDomain` | 5/7 | 11 | 36 | 10 |
| `counter-authority` | `CounterAuthority.dfy` | `CounterDomain` | 3/5 | 3 | 10 | 4 |
| `clear-split` | `ClearSplit.dfy` | `ClearSplit` | 20/20 | 60 | 59 | 6 |
| `kanban-multi` | `KanbanMultiCollaboration.dfy` | `KanbanDomain` | 4/8 | 11 | 53 | 6 |
| `clear-split-multi` | `ClearSplitMultiCollaboration.dfy` | `ClearSplitDomain` | 22/26 | 62 | 76 | 13 |
| `collab-todo` | `TodoMultiCollaboration.dfy` | `TodoDomain` | 39/43 | 117 | 105 | 12 |

Preds column shows predicates-with-body/total (abstract ghost predicates have no body). None of the current projects have axioms.

### Multi-file projects

Most projects use a single domain file that `include`s a shared kernel:

```dafny
// CounterDomain.dfy
include "../kernels/Replay.dfy"

module CounterDomain refines Domain {
  // ...
}
```

When you run `dafny2js --claims --file CounterDomain.dfy`, it resolves the include and extracts claims from all modules — `CounterDomain`, `Domain` (abstract), `Kernel`, `CounterKernel`, etc. Use `--module CounterDomain` in claimcheck to filter to just the domain-specific claims and skip kernel duplicates.

### Using with claimcheck

Either use `--extract` to have claimcheck invoke dafny2js:

```bash
claimcheck \
  --extract --dafny2js ../dafny-replay/dafny2js \
  --dfy ../dafny-replay/counter/CounterDomain.dfy \
  -r requirements.md --module CounterDomain -d Counter
```

Or extract manually and pass the JSON:

```bash
cd ../dafny-replay/dafny2js
dotnet run --no-build -- --file ../counter/CounterDomain.dfy --claims > /tmp/claims.json

cd ../../claimcheck
claimcheck -c /tmp/claims.json -r requirements.md --module CounterDomain -d Counter
```

## Install

```bash
npm install
```

## Tests

```bash
# Unit tests
node --test test/flatten.test.js

# Integration suite: extract claims from all dafny-replay projects + flatten
./test/integration/run-suite.sh

# Full pipeline on a specific project (needs ANTHROPIC_API_KEY + dafny)
./test/integration/run-suite.sh --full counter
```

The integration suite (`test/integration/`) runs `dafny2js --claims` on all 10 dafny-replay projects and flattens the results. Claim JSON snapshots are saved to `test/integration/claims/`. Requirements files for 5 projects are in `test/integration/reqs/`.
