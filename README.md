# claimcheck

Does a formally verified Dafny specification cover a set of informal user requirements?

For each requirement, claimcheck formalizes a Dafny lemma and asks the theorem prover to verify it. Two attempts, then an obligation.

## Pipeline

```
for each requirement:
    1. Formalize   LLM writes a Dafny lemma from the requirement + domain source
    2. Verify      Dafny checks it
    3. If failed:  LLM retries once with the Dafny error
    4. If failed:  emit as obligation
```

No claims extraction. No NL translation. No matching. The LLM reads the source directly.

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
  // Strategies: direct✗ → retry✗
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
