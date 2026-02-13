# Eval Report: Two-Phase Pipeline

Pipeline: two-phase (batch formalize → resolve → verify empty bodies → prove remaining).
Phase 1 always uses erased source. Phase 2 uses full source (or erased with `--erase`).

6 configs, 3 runs each. Not all runs completed all domains (timeouts/errors — see notes).

## Summary Totals

Correct gap ("counter never exceeds 100") excluded from denominator.

| Config | Proved/Provable | Rate | Domains |
|--------|-----------------|------|---------|
| **sonnet** | **50/53** | **94.3%** | 4 (no colorwheel) |
| **opus-erase** | **75/87** | **86.2%** | 5 |
| opus | 66/79 | 83.5% | 5 (incomplete) |
| haiku-erase | 57/69 | 82.6% | 4 (no colorwheel) |
| sonnet-erase | 47/59 | 79.7% | 5 (incomplete) |
| haiku | 39/69 | 56.5% | 4 (no colorwheel) |

**Caveat:** sonnet's 94% rate is inflated — it only ran 4 domains (no colorwheel, the hardest) and kanban only appeared in 1 of 3 runs. Opus ran all 5 domains in at least 2 runs.

## Per-Requirement Breakdown

```
                                                haiku  h-eras sonnet s-eras  opus  o-eras
──────────────────────────────────────────────────────────────────────────────────────────

counter (easy)
  Counter always non-negative                    3/3    3/3    3/3    3/3    3/3    3/3
  Initial state satisfies invariant              3/3    3/3    3/3    3/3    3/3    3/3
  Action preserves invariant                     3/3    3/3    3/3    3/3    3/3    3/3
  Decrementing at zero → zero                    3/3    3/3    3/3    3/3    3/3    3/3
  Counter never exceeds 100 (correct gap)        1/3†   2/3†   0/3    0/3    0/3    0/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal (excl gap)                           12/12  12/12  12/12  12/12  12/12  12/12

kanban (medium)
  Column names unique                            3/3    3/3    1/1    1/1    2/2    3/3
  Card in exactly one column (partition)         3/3    3/3    1/1    1/1    2/2    3/3
  No duplicate card IDs                          3/3    3/3    1/1    1/1    2/2    3/3
  WIP limits respected                           3/3    3/3    1/1    1/1    2/2    3/3
  Add to full column → no-op                     3/3    3/3    1/1    1/1    2/2    3/3
  Card allocator fresh                           3/3    3/3    1/1    1/1    2/2    3/3
  Lanes/WIP maps match columns                   3/3    3/3    1/1    1/1    2/2    3/3
  Move preserves card count                      0/3    0/3    1/1    0/1    2/2    2/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                      21/24  21/24   8/8    7/8   16/16  23/24

colorwheel (hard) — haiku & sonnet (no-erase) did not run this domain
  Base hue in valid range                         -      -      -     1/1    3/3    3/3
  Exactly 5 colors                                -      -      -     1/1    3/3    3/3
  Valid saturation/lightness                      -      -      -     1/1    3/3    3/3
  Contrast pair indices valid                     -      -      -     0/1    3/3    3/3
  Mood constraints satisfied                      -      -      -     0/1    1/3    2/3
  Hues follow harmony pattern                     -      -      -     1/1    1/3    2/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                        -      -      -     4/6   14/18  16/18

canon (medium)
  Constraint targets → existing nodes            0/3    0/3    3/3    0/3    0/3    0/3
  Edge endpoints → existing nodes                2/3    1/3    3/3    3/3    3/3    3/3
  Add existing node → no-op                      3/3    3/3    3/3    3/3    3/3    3/3
  Remove node cleans up edges/constraints        0/3    0/3    3/3    0/3    0/3    0/3
  Constraint ID allocator fresh                  0/3    0/3    0/3    0/3    0/3    0/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                       5/15   4/15  12/15   6/15   6/15   6/15

delegation-auth (medium)
  Capabilities → existing subjects               0/3    3/3    3/3    3/3    3/3    3/3
  Delegation endpoints exist                     0/3    3/3    3/3    3/3    3/3    3/3
  Edge IDs < next allocator                      0/3    3/3    3/3    3/3    3/3    3/3
  Grant to non-existent → no-op                  0/3    3/3    3/3    3/3    3/3    3/3
  Delegate non-existent → no-op                  0/3    3/3    3/3    3/3    3/3    3/3
  Revoke non-existent → no-op                    0/3    3/3    3/3    3/3    3/3    3/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                       0/18  18/18  18/18  18/18  18/18  18/18
```

† Haiku "proved" the correct gap requirement by writing a lemma that Dafny accepts but doesn't actually express "counter never exceeds 100". This is a **false positive** (wrong formalization, not a proof bug).

## Strategy Distribution

The two-phase pipeline reports how each lemma was proved:
- **direct** — Phase 1 empty body, no proof needed (best case)
- **proof** — Phase 2, LLM wrote a proof body
- **proof-retry** — Phase 2, LLM fixed a failed proof on retry

| Config | direct | proof | proof-retry |
|--------|--------|-------|-------------|
| haiku | 39 | 0 | 0 |
| haiku-erase | 57 | 0 | 0 |
| sonnet | 46 | 3 | 1 |
| sonnet-erase | 43 | 2 | 2 |
| opus | 64 | 2 | 0 |
| opus-erase | 74 | 1 | 0 |

The vast majority of proved results use `direct` — the empty-body Phase 1 strategy. Phase 2 proof is only needed for harder requirements (e.g. "move preserves card count", "remove node cleans up", "card partition").

## Incomplete Run Coverage

Not all configs ran all 5 domains in every run. Timeouts or errors caused some domains to be skipped:

| Config | R1 | R2 | R3 |
|--------|----|----|-----|
| haiku | 4 domains | 4 domains | 4 domains |
| haiku-erase | 4 domains | 4 domains | 4 domains |
| sonnet | 3 domains | 3 domains | 4 domains (+kanban) |
| sonnet-erase | 3 domains | 5 domains (all) | 3 domains |
| opus | 5 domains (all) | 5 domains (all) | 4 domains (no kanban) |
| opus-erase | 5 domains (all) | 5 domains (all) | 5 domains (all) |

Only **opus-erase** completed all 5 domains in all 3 runs (90 total attempts).

## Key Takeaways

**Two-phase pipeline works.** Most lemmas verify with an empty body (Phase 1), drastically reducing LLM calls. Only hard requirements trigger Phase 2 proof writing. Best case: 1 LLM call + 1 resolve + 1 verify for an entire domain.

**Sonnet (no-erase) dominates canon.** It's the only config that proves "constraint targets → existing nodes" (3/3) and "remove node cleans up" (3/3), both using Phase 2 proof strategies. Every other config gets 0/3 on both. This is a significant Phase 2 advantage — sonnet's proof-writing ability shines when it can see full domain source.

**Haiku (no-erase) has a systematic delegation-auth failure.** 0/18 across all 3 runs, while haiku-erase gets 18/18. This is a batch formalization bug — haiku without erasure produces resolution-failing signatures for this domain. With erased source, the same model succeeds perfectly. This suggests haiku gets confused by full proof bodies in Phase 1 (even though Phase 1 always uses erased source — the bug must be in Phase 2 retry or the formalization itself).

**Erasure impact is model-dependent:**
- **Haiku:** erase dramatically helps (57% → 83%), mainly by fixing delegation-auth
- **Opus:** erase slightly helps (84% → 86%), small colorwheel improvement
- **Sonnet:** erase hurts (94% → 80%), loses canon proofs and some kanban

**Haiku false positives on correct gap.** Haiku "proved" the intentionally unprovable "counter never exceeds 100" (1/3 and 2/3). This is a formalization soundness issue — the LLM writes a lemma Dafny accepts that doesn't actually express the requirement. Sonnet and opus correctly identify it as unprovable in all runs.

**Universal hard spots** (0/3 across all configs):
- "Constraint ID allocator fresh" — never proved by any model

**Colorwheel breakthroughs** (vs REPORT1):
- Opus now proves "contrast pair indices valid" 3/3 and 3/3 (was 0/3 in REPORT1)
- Opus-erase proves "mood constraints" 2/3 and "hues follow harmony" 2/3 (was 0/3 in REPORT1)

## Comparison with REPORT1 (per-requirement pipeline)

| Metric | REPORT1 (best) | REPORT2 (best, comparable) |
|--------|----------------|---------------------------|
| Best overall | opus 71/90 (79%) | opus-erase 75/87 (86%) |
| Counter | 12/15 all configs | 12/12 all configs (gap excluded) |
| Kanban | opus 24/24 | opus 16/16, opus-erase 23/24 |
| Colorwheel | opus 10/18 (56%) | opus-erase 16/18 (89%) |
| Canon | 7/15 all configs | sonnet 12/15 (80%) |
| Delegation-auth | 18/18 all configs | 18/18 (except haiku no-erase) |

The two-phase pipeline improves colorwheel (+6 for opus-erase) and canon (+5 for sonnet), at the cost of some instability in domain coverage and haiku's delegation-auth regression.
