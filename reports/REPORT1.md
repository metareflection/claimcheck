# Eval Report: Model + Erasure Comparison

commit: ba5bd2b14af0b623cc705c5e722e75e7b812f61f

6 configs, 30 requirements, 3 runs each (90 proof attempts per config).

## Summary Totals

| Config | Proved | Rate |
|--------|--------|------|
| **opus** | **71/90** | **78.9%** |
| opus-erase | 70/90 | 77.8% |
| haiku | 68/90 | 75.6% |
| sonnet-erase | 66/90 | 73.3% |
| sonnet | 63/90 | 70.0% |
| haiku-erase | 63/90 | 70.0% |

## Per-Requirement Breakdown

```
                                                haiku  h-eras sonnet s-eras  opus  o-eras
──────────────────────────────────────────────────────────────────────────────────────────

counter (easy)
  Counter always non-negative                    3/3    3/3    3/3    3/3    3/3    3/3
  Initial state satisfies invariant              3/3    3/3    3/3    3/3    3/3    3/3
  Action preserves invariant                     3/3    3/3    3/3    3/3    3/3    3/3
  Decrementing at zero → zero                    3/3    3/3    3/3    3/3    3/3    3/3
  Counter never exceeds 100 (correct gap)        0/3    0/3    0/3    0/3    0/3    0/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                      12/15  12/15  12/15  12/15  12/15  12/15

kanban (medium)
  Column names unique                            3/3    3/3    3/3    3/3    3/3    3/3
  Card in exactly one column (partition)         3/3    2/3    1/3    0/3    3/3    2/3
  No duplicate card IDs                          3/3    2/3    3/3    3/3    3/3    3/3
  WIP limits respected                           3/3    3/3    3/3    3/3    3/3    3/3
  Add to full column → no-op                     3/3    3/3    3/3    3/3    3/3    3/3
  Card allocator fresh                           3/3    3/3    3/3    3/3    3/3    3/3
  Lanes/WIP maps match columns                   3/3    3/3    3/3    3/3    3/3    3/3
  Move preserves card count                      1/3    0/3    0/3    0/3    3/3    3/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                      22/24  19/24  19/24  18/24  24/24  23/24

colorwheel (hard)
  Base hue in valid range                        3/3    3/3    3/3    3/3    3/3    3/3
  Exactly 5 colors                               3/3    3/3    2/3    3/3    3/3    3/3
  Valid saturation/lightness                     0/3    0/3    2/3    2/3    3/3    3/3
  Contrast pair indices valid                    2/3    0/3    0/3    2/3    0/3    0/3
  Mood constraints satisfied                     0/3    0/3    0/3    0/3    0/3    0/3
  Hues follow harmony pattern                    1/3    1/3    0/3    1/3    1/3    1/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                       9/18   7/18   7/18  11/18  10/18  10/18

canon (medium)
  Constraint targets → existing nodes            2/3    2/3    1/3    1/3    1/3    1/3
  Edge endpoints → existing nodes                2/3    3/3    3/3    3/3    3/3    3/3
  Add existing node → no-op                      3/3    2/3    3/3    3/3    3/3    3/3
  Remove node cleans up edges/constraints        0/3    0/3    0/3    0/3    0/3    0/3
  Constraint ID allocator fresh                  0/3    0/3    0/3    0/3    0/3    0/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                       7/15   7/15   7/15   7/15   7/15   7/15

delegation-auth (medium)
  Capabilities → existing subjects               3/3    3/3    3/3    3/3    3/3    3/3
  Delegation endpoints exist                     3/3    3/3    3/3    3/3    3/3    3/3
  Edge IDs < next allocator                      3/3    3/3    3/3    3/3    3/3    3/3
  Grant to non-existent → no-op                  3/3    3/3    3/3    3/3    3/3    3/3
  Delegate non-existent → no-op                  3/3    3/3    3/3    3/3    3/3    3/3
  Revoke non-existent → no-op                    3/3    3/3    3/3    3/3    3/3    3/3
                                              ──────  ─────  ─────  ─────  ─────  ─────
  subtotal                                      18/18  18/18  18/18  18/18  18/18  18/18
```

## Key Takeaways

**Opus is the clear winner**, driven almost entirely by kanban:
- Only model that nails "move preserves card count" (3/3 vs 0-1/3 for others) and "card partition" (3/3 consistently).
- kanban: opus gets 24/24, vs 18-22 for everyone else.

**Erasure mostly hurts.** Removing lemma proof bodies before showing source to the LLM:
- haiku → haiku-erase: 68 → 63 (-5)
- opus → opus-erase: 71 → 70 (-1, negligible)
- sonnet → sonnet-erase: 63 → 66 (+3, slight improvement)

Sonnet-erase is the one exception where erasure helps, mainly from a colorwheel bump (7 → 11). This is noisy though given only 3 runs.

**Universal hard spots** (0/3 across all configs):
- "Counter never exceeds 100" — correct gap (unprovable by design)
- "Mood constraints satisfied" — hardest colorwheel requirement
- "Remove node cleans up edges/constraints" — hardest canon requirement
- "Constraint ID allocator fresh" — hardest canon requirement

**Haiku punches above its weight** — 68/90 without erasure, only 3 behind opus, and notably better than sonnet on "card partition" (3/3 vs 1/3) and "constraint targets" (2/3 vs 1/3). Its main weakness vs opus is "move preserves card count" (1/3 vs 3/3) and "saturation/lightness" (0/3 vs 3/3).
