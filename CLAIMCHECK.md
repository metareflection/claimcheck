# Using claimcheck

claimcheck confirms that Dafny lemmas actually express the natural-language requirements they claim to cover. 

## When to use

After writing or modifying Dafny lemmas that claim to formalize natural-language requirements, run claimcheck to verify the claims are faithful.

## How to run

Point at a mapping JSON and a .dfy file:

```bash
claimcheck \
  -m mapping.json \
  --dfy claims.dfy \
  -d mydomain \
  --json
```

The mapping JSON is an array of `{ requirement, lemmaName }` objects. The .dfy file contains the lemmas referenced by `lemmaName`. The `--module` flag is optional (only needed with `--verify` for module-based .dfy files).

A `--stdin` mode is also available for programmatic use — pipe `{ "claims": [{ requirement, lemmaName, dafnyCode }], "domain": "..." }` as JSON and get results on stdout.

### Using `--claude-code`

Add `--claude-code` to run via `claude -p` instead of the Anthropic API directly. This uses your existing Claude Code authentication and model routing.

When running from inside a Claude Code session, the command must be run in the background with output redirected to files — foreground execution will appear to produce no output:

```bash
node /path/to/claimcheck/bin/claimcheck.js \
  -m mapping.json \
  --dfy claims.dfy \
  -d mydomain \
  --json \
  --claude-code \
  > /tmp/cc-out.json 2> /tmp/cc-err.log &
```

Then check results with `cat /tmp/cc-out.json`.

## Interpreting results

Each claim gets one of:

| Status | Meaning | Action |
|--------|---------|--------|
| `confirmed` | Lemma faithfully expresses the requirement | None needed |
| `disputed` | Discrepancy detected | Fix the lemma or refine the requirement |
| `error` | Lemma not found in source | Check the lemmaName matches |

Disputed results include `discrepancy` (what's wrong) and `weakeningType` (category: `tautology`, `weakened-postcondition`, `narrowed-scope`, `wrong-property`).

## Workflow

1. Write or update Dafny lemmas that formalize requirements
2. Create a mapping: `[{ "requirement": "...", "lemmaName": "..." }, ...]`
3. Run claimcheck
4. Fix any disputed claims
5. Re-run until all claims are confirmed
