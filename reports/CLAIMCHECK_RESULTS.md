# Claimcheck Audit Results

Core task: given a Dafny lemma and a natural-language requirement, does the lemma actually express what the requirement says? 36 requirement-lemma pairs across 5 domains, including 8 deliberately bogus lemmas (tautologies, weakened postconditions, narrowed scope, wrong properties).

## Accuracy

| Variant | Accuracy | Runs | Time/run | API calls/run |
|---------|----------|------|----------|---------------|
| **Two-pass** (default) | **96.3%** (104/108) | 3 | ~108s | 2 (batch) |
| Single-prompt | 86.1% (31/36) | 1 | ~353s | 36 |
| Claude Code | 69.4% (25/36) | 1 | ~693s | 36 |

Model: `claude-sonnet-4-5-20250929` for all variants. Two-pass uses haiku for informalization, sonnet for comparison.

## Per-Domain Breakdown

```
                                              exp    two-pass    single    cc
──────────────────────────────────────────────────────────────────────────────

canon (6 pairs, 2 bogus)
  AddExistingNodeIsNoop                        ok     3/3        1/1      1/1
  ConstraintTargetsExist                       ok     3/3        1/1      1/1
  ConstraintTargetsExistEmpty                bogus    3/3        1/1      1/1
  EdgeEndpointsExist                           ok     3/3        1/1      0/1 ↓
  RemoveNodeCleansUp                           ok     3/3        1/1      1/1
  RemoveNodeDropsId                          bogus    3/3        1/1      1/1
                                                      18/18      6/6      5/6

colorwheel (7 pairs, 1 bogus)
  AllColorsValid                               ok     3/3        1/1      0/1 ↓
  AlwaysFiveColors                             ok     3/3        1/1      0/1 ↓
  BaseHueInRange                               ok     3/3        1/1      0/1 ↓
  ContrastPairIndicesValid                     ok     3/3        1/1      1/1
  HuesFollowHarmony                            ok     3/3        1/1      0/1 ↓
  MoodConstraintsSatisfied                     ok     3/3        1/1      1/1
  PaletteNonEmpty                            bogus    3/3        1/1      1/1
                                                      21/21      7/7      3/7

counter (7 pairs, 3 bogus)
  CounterNonNegative                           ok     3/3        0/1 ↓    1/1
  InitSatisfiesInvariant                       ok     3/3        1/1      1/1
  StepPreservesInvariant                       ok     3/3        0/1 ↓    1/1
  DecAtZeroKeepsZero                           ok     3/3        1/1      1/1
  CounterLowerBound                          bogus    3/3        1/1      1/1
  CounterNonNegAlt                           bogus    3/3        1/1      1/1
  CounterNonNegLarge                         bogus    3/3        1/1      1/1
                                                      21/21      6/7      7/7

delegation-auth (7 pairs, 1 bogus)
  GrantSubjectsExist                           ok     3/3        0/1 ↓    0/1 ↓
  DelegationEndpointsExist                     ok     3/3        1/1      0/1 ↓
  EdgeIdsFresh                                 ok     3/3        1/1      1/1
  GrantNonExistentIsNoop                       ok     3/3        1/1      1/1
  DelegateNonExistentIsNoop                    ok     3/3        0/1 ↓    0/1 ↓
  RevokeNonExistentIsNoop                      ok     3/3        1/1      1/1
  GrantNonExistentIsNoopInit                 bogus    3/3        1/1      1/1
                                                      21/21      5/7      4/7

kanban (9 pairs, 2 bogus)
  ColumnsAreUnique                             ok     3/3        1/1      1/1
  CardInExactlyOneColumn                       ok     0/3        0/1      0/1
  NoCardDuplicates                             ok     3/3        1/1      1/1
  WipLimitsRespected                           ok     2/3        1/1      0/1 ↓
  AddCardToFullColumnIsNoop                    ok     3/3        1/1      1/1
  AllocatorAlwaysFresh                         ok     3/3        1/1      0/1 ↓
  LanesAndWipMatchColumns                      ok     3/3        1/1      1/1
  MoveCardPreservesTotal                     bogus    3/3        1/1      1/1
  CardPartitionNoDups                        bogus    3/3        1/1      1/1
                                                      23/27      7/9      6/9
```

## What Two-Pass Gets Wrong

Only 4 errors in 108 judgments, all on kanban:

- **CardInExactlyOneColumn** (0/3): The lemma expresses a partition property using multiset cardinality. The informalization step consistently fails to recover the "exactly one column" phrasing from the multiset math — it describes membership without exclusivity. This is a genuine informalization difficulty, not an anchoring problem.
- **WipLimitsRespected** (2/3): One run's informalization described the WIP property in terms that were close but not precise enough for the comparison step to confirm.

All 8 bogus lemmas were correctly flagged as disputed in all 3 runs (24/24).

## What Single-Prompt Gets Wrong

5 errors in 36 judgments:

- **CounterNonNegative** and **StepPreservesInvariant**: falsely disputed valid lemmas. The model sees the requirement and lemma together and over-analyzes — finding "discrepancies" that don't exist. This is the anchoring problem that two-pass avoids.
- **GrantSubjectsExist** and **DelegateNonExistentIsNoop**: same pattern — valid lemmas flagged as insufficient when the model reads too much into the comparison.

## What Claude Code Gets Wrong

11 errors in 36 judgments. Three failure patterns:

1. **Colorwheel collapse** (4/6 valid lemmas wrong): Without structured output, Claude Code struggles to faithfully informalize mathematical constraints on HSL color values. It confirms only the simpler properties (contrast indices, mood) and falsely disputes the ones involving ranges and harmony patterns.
2. **Delegation-auth false disputes** (3/6 valid wrong): Same over-analysis as single-prompt, but worse — the general-purpose system prompt encourages "helpful" elaboration that turns into spurious objections.
3. **Kanban false disputes** (2/7 valid wrong): WipLimitsRespected and AllocatorAlwaysFresh — properties involving allocator freshness and WIP invariants are misread.

## Key Takeaways

**Structural separation is the dominant factor.** The 10-point gap between two-pass (96.3%) and single-prompt (86.1%) comes from preventing anchoring bias. When the informalization model can't see the requirement, it can't be primed by it. The back-translation is honest.

**Bogus detection is easy; valid confirmation is hard.** All three variants catch bogus lemmas reliably (8/8 across the board). The accuracy differences come entirely from false disputes of valid lemmas — the model being too skeptical, not too credulous.

**Batching is a free lunch.** Two-pass makes 2 API calls per run vs 36. It's both more accurate and 3x faster. The batch informalize call processes all lemmas at once without cross-contamination, because each lemma is independent.

**The remaining gap is informalization fidelity.** The 4 two-pass errors are all cases where haiku's back-translation loses important semantic content (multiset partition logic, WIP threshold semantics). These could potentially be addressed by using a stronger informalization model on hard domains, at the cost of more anchoring risk if the model is "too smart" and infers the requirement.

## Demo: Election Tally

The election domain (11 requirement-lemma pairs) serves as the primary demo. Two variants:

- **election0** (buggy): 9 confirmed, 2 disputed. Claimcheck catches:
  - `OrderIrrelevant` — narrowed scope: lemma only proves prepend == append for a single ballot, not arbitrary reorderings
  - `TallyMonotonic` — wrong property: lemma proves `Count(...) >= 0` (trivially true) instead of monotonicity
- **election** (fixed): 11/11 confirmed after fixing both lemmas
