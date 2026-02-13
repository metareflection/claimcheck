# claimcheck

Does a formally verified Dafny specification cover a set of informal user requirements?

Claimcheck formalizes Dafny lemmas for all requirements and asks the theorem prover to verify them. A two-phase pipeline separates formalization (getting types right) from proof (filling in proof bodies).

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

Best case: 1 LLM call + 1 resolve + 1 verify = done.

Phase 1 always uses erased source (lemma bodies stripped, marked `{:axiom}`). Phase 2 uses full source by default, or erased source with `--erase`. Generated lemmas are rejected if they contain `assume` or `{:axiom}` (soundness checks).

## Usage

```bash
# Single project
node bin/claimcheck.js \
  -r test/integration/reqs/counter.md \
  --dfy ../dafny-replay/counter/CounterDomain.dfy \
  --module CounterDomain -d counter

# JSON output
node bin/claimcheck.js \
  -r test/integration/reqs/counter.md \
  --dfy ../dafny-replay/counter/CounterDomain.dfy \
  --module CounterDomain -d counter --json

# All test projects
node test/integration/run-all.js

# Single test project
node test/integration/run-all.js counter
```

## Options

| Flag | Description |
|------|-------------|
| `-r, --requirements <path>` | Path to requirements file (markdown) |
| `--dfy <path>` | Path to domain .dfy file |
| `--module <name>` | Dafny module name to import |
| `-d, --domain <name>` | Human-readable domain name (default: module name) |
| `-o, --output <dir>` | Output directory for obligations.dfy (default: `.`) |
| `--json` | Output JSON instead of markdown |
| `--model <id>` | Override LLM model (default: `claude-sonnet-4-5-20250929`) |
| `--erase` | Also erase lemma bodies for Phase 2 (Phase 1 always uses erased source) |
| `-v, --verbose` | Verbose API/verification logging |

## Output

**Markdown report** with sections:
- Formally Verified Requirements — with the proved Dafny lemma
- Obligations — requirements that need manual proof

**obligations.dfy** — a Dafny module with lemma stubs for each unproved requirement:

```dafny
include "../dafny-replay/counter/CounterDomain.dfy"

module Obligations {
  import D = CounterDomain

  // Requirement: "The counter never exceeds 100"
  // Status: unproven after 2 attempt(s)
  // Strategies: direct✗ → proof✗ → proof-retry✗
  lemma CounterNeverExceeds100(m: D.Model)
    requires D.Inv(m)
    ensures m <= 100
  { /* OBLIGATION */ }
}
```

## Test Projects

| Project | Domain file | Module |
|---------|------------|--------|
| counter | `counter/CounterDomain.dfy` | CounterDomain |
| kanban | `kanban/KanbanDomain.dfy` | KanbanDomain |
| colorwheel | `colorwheel/ColorWheelDomain.dfy` | ColorWheelDomain |
| canon | `canon/CanonDomain.dfy` | CanonDomain |
| delegation-auth | `delegation-auth/DelegationAuthDomain.dfy` | DelegationAuthDomain |

Requirements files live in `test/integration/reqs/`. Domain `.dfy` files are in `../dafny-replay/`.

## Requirements

- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable
- `dafny` in PATH
