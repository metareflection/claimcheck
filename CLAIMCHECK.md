# Using claimcheck

claimcheck verifies that Dafny lemmas actually express the natural-language requirements they claim to cover. 

## When to use

After writing or modifying Dafny lemmas that claim to formalize natural-language requirements, run claimcheck to verify the claims are faithful.

## How to run

### Option 1: Stdin mode (preferred for programmatic use)

Pipe pre-extracted claims as JSON:

```bash
echo '{
  "claims": [
    {
      "requirement": "The counter value is always non-negative",
      "lemmaName": "CounterNonNegative",
      "dafnyCode": "lemma CounterNonNegative(m: int)\n  requires Inv(m)\n  ensures m >= 0\n{}"
    }
  ],
  "domain": "mydomain"
}' | node /path/to/claimcheck/bin/claimcheck.js --stdin
```

The input JSON has:
- `claims`: array of `{ requirement, lemmaName, dafnyCode }` objects
- `domain`: human-readable domain name (used in LLM prompts)

The output JSON has:
- `results`: array of `{ requirement, lemmaName, status, ... }` where status is `confirmed`, `disputed`, or `error`
- `tokenUsage`: `{ input, output }`

### Option 2: File mode

Point at a mapping JSON and a .dfy file:

```bash
node /path/to/claimcheck/bin/claimcheck.js \
  -m mapping.json \
  --dfy claims.dfy \
  -d mydomain \
  --json
```

The mapping JSON is an array of `{ requirement, lemmaName }` objects. The .dfy file contains the lemmas referenced by `lemmaName`. The `--module` flag is optional (only needed with `--verify` for module-based .dfy files).

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
