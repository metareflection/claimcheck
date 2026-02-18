# Claimcheck Audit Results

Core task: given a Dafny lemma and a natural-language requirement, does the lemma actually express what the requirement says? 36 requirement-lemma pairs across 5 domains, including 8 deliberately bogus lemmas (tautologies, weakened postconditions, narrowed scope, wrong properties).

## Accuracy

| Variant | Accuracy | Runs | Time/run | API calls/run |
|---------|----------|------|----------|---------------|
| **Two-pass** (default) | **96.3%** (104/108) | 3 | ~108s | 2 (batch) |
| Naive (Opus) | 94.4% (102/108) | 3 | ~107s | 36 |
| Single-prompt | 86.1% (31/36) | 1 | ~353s | 36 |
| Naive (Sonnet) | 88.9% (96/108) | 3 | ~147s | 36 |
| Claude Code | 69.4% (25/36) | 1 | ~693s | 36 |

Model: `claude-sonnet-4-5-20250929` unless noted. Two-pass uses haiku for informalization, sonnet for comparison.

## Per-Domain Breakdown

```
                                              exp    two-pass    single   naive/S  naive/O    cc
──────────────────────────────────────────────────────────────────────────────────────────────────

canon (6 pairs, 2 bogus)
  AddExistingNodeIsNoop                        ok     3/3        1/1      3/3      3/3      1/1
  ConstraintTargetsExist                       ok     3/3        1/1      3/3      3/3      1/1
  ConstraintTargetsExistEmpty                bogus    3/3        1/1      3/3      3/3      1/1
  EdgeEndpointsExist                           ok     3/3        1/1      3/3      3/3      0/1 ↓
  RemoveNodeCleansUp                           ok     3/3        1/1      3/3      3/3      1/1
  RemoveNodeDropsId                          bogus    3/3        1/1      3/3      3/3      1/1
                                                      18/18      6/6      18/18    18/18    5/6

colorwheel (7 pairs, 1 bogus)
  AllColorsValid                               ok     3/3        1/1      0/3 ↓    3/3      0/1 ↓
  AlwaysFiveColors                             ok     3/3        1/1      3/3      3/3      0/1 ↓
  BaseHueInRange                               ok     3/3        1/1      3/3      3/3      0/1 ↓
  ContrastPairIndicesValid                     ok     3/3        1/1      3/3      3/3      1/1
  HuesFollowHarmony                            ok     3/3        1/1      3/3      3/3      0/1 ↓
  MoodConstraintsSatisfied                     ok     3/3        1/1      3/3      3/3      1/1
  PaletteNonEmpty                            bogus    3/3        1/1      3/3      3/3      1/1
                                                      21/21      7/7      18/21    21/21    3/7

counter (7 pairs, 3 bogus)
  CounterNonNegative                           ok     3/3        0/1 ↓    0/3 ↓    3/3      1/1
  InitSatisfiesInvariant                       ok     3/3        1/1      3/3      3/3      1/1
  StepPreservesInvariant                       ok     3/3        0/1 ↓    3/3      3/3      1/1
  DecAtZeroKeepsZero                           ok     3/3        1/1      3/3      3/3      1/1
  CounterLowerBound                          bogus    3/3        1/1      3/3      3/3      1/1
  CounterNonNegAlt                           bogus    3/3        1/1      3/3      3/3      1/1
  CounterNonNegLarge                         bogus    3/3        1/1      3/3      3/3      1/1
                                                      21/21      6/7      18/21    21/21    7/7

delegation-auth (7 pairs, 1 bogus)
  GrantSubjectsExist                           ok     3/3        0/1 ↓    0/3 ↓    0/3 ↓    0/1 ↓
  DelegationEndpointsExist                     ok     3/3        1/1      3/3      3/3      0/1 ↓
  EdgeIdsFresh                                 ok     3/3        1/1      3/3      3/3      1/1
  GrantNonExistentIsNoop                       ok     3/3        1/1      3/3      3/3      1/1
  DelegateNonExistentIsNoop                    ok     3/3        0/1 ↓    0/3 ↓    0/3 ↓    0/1 ↓
  RevokeNonExistentIsNoop                      ok     3/3        1/1      3/3      3/3      1/1
  GrantNonExistentIsNoopInit                 bogus    3/3        1/1      3/3      3/3      1/1
                                                      21/21      5/7      15/21    15/21    4/7

kanban (9 pairs, 2 bogus)
  ColumnsAreUnique                             ok     3/3        1/1      3/3      3/3      1/1
  CardInExactlyOneColumn                       ok     0/3        0/1      3/3      3/3      0/1
  NoCardDuplicates                             ok     3/3        1/1      3/3      3/3      1/1
  WipLimitsRespected                           ok     2/3        1/1      3/3      3/3      0/1 ↓
  AddCardToFullColumnIsNoop                    ok     3/3        1/1      3/3      3/3      1/1
  AllocatorAlwaysFresh                         ok     3/3        1/1      3/3      3/3      0/1 ↓
  LanesAndWipMatchColumns                      ok     3/3        1/1      3/3      3/3      1/1
  MoveCardPreservesTotal                     bogus    3/3        1/1      3/3      3/3      1/1
  CardPartitionNoDups                        bogus    3/3        1/1      3/3      3/3      1/1
                                                      23/27      7/9      27/27    27/27    6/9
```

## What Two-Pass Gets Wrong

Only 4 errors in 108 judgments, all on kanban:

- **CardInExactlyOneColumn** (0/3): The lemma expresses a partition property using multiset cardinality. The informalization step consistently fails to recover the "exactly one column" phrasing from the multiset math — it describes membership without exclusivity. This is a genuine informalization difficulty, not an anchoring problem.
- **WipLimitsRespected** (2/3): One run's informalization described the WIP property in terms that were close but not precise enough for the comparison step to confirm.

All 8 bogus lemmas were correctly flagged as disputed in all 3 runs (24/24).

## What Naive Gets Wrong

**Naive (Sonnet):** 4 errors in 36 judgments:

- **CounterNonNegative**: falsely disputed — same as single-prompt.
- **AllColorsValid**: falsely disputed — without structured reasoning, the model doesn't work through the HSL constraint math carefully enough.
- **GrantSubjectsExist** and **DelegateNonExistentIsNoop**: falsely disputed — same as single-prompt. These delegation-auth lemmas are consistently hard across all single-call variants.

**Naive (Opus):** Only 2 errors in 36 judgments:

- **GrantSubjectsExist** and **DelegateNonExistentIsNoop**: the same two delegation-auth false disputes that every single-call variant gets wrong. These appear to be genuinely hard for any model that sees both artifacts together — possibly the invariant structure in these lemmas is confusing enough to trigger false skepticism regardless of prompt structure.

Opus gets everything else right, including items that trip up sonnet variants: CounterNonNegative, AllColorsValid, AllocatorAlwaysFresh, CardInExactlyOneColumn. This suggests that for the naive approach, model capability matters more than prompt engineering.

All 8 bogus lemmas correctly flagged by both models (8/8).

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

**Model capability dominates prompt structure.** Naive Opus (94.4%) nearly matches two-pass Sonnet (96.3%) with zero prompt engineering — just "does this match?" Meanwhile, single-prompt Sonnet's careful two-pass-in-one-call structure scores the same as naive Sonnet (86.1%). For a fixed model, adding prompt structure doesn't help; upgrading the model does.

**Structural separation still matters for weaker models.** The gap between two-pass Sonnet (96.3%) and naive Sonnet (88.9%) shows that when the model isn't strong enough to resist anchoring on its own, forcing blind informalization via separate API calls compensates. But Opus doesn't need that crutch.

**Prompt-level structure doesn't help.** Single-prompt Sonnet's careful two-pass-in-one-call structure (86.1%) scores worse than naive Sonnet with invariant guidance (88.9%). The two-pass prompt engineering — asking the model to informalize before comparing within a single call — doesn't improve accuracy over just asking "does this match?" The model either ignores the structure or trades one class of errors for another.

**GrantSubjectsExist and DelegateNonExistentIsNoop are irreducibly hard.** Every single-call variant (naive, single-prompt, Claude Code) across both Sonnet and Opus gets these two delegation-auth lemmas wrong. Only two-pass with structural separation gets them right. These may be cases where the invariant structure genuinely requires blind informalization to avoid anchoring.

**Bogus detection is easy; valid confirmation is hard.** All variants catch bogus lemmas reliably (8/8 across the board). The accuracy differences come entirely from false disputes of valid lemmas — the model being too skeptical, not too credulous.

**Batching is a free lunch.** Two-pass makes 2 API calls per run vs 36. It's both more accurate and 3x faster. The batch informalize call processes all lemmas at once without cross-contamination, because each lemma is independent.

**The remaining gap is informalization fidelity.** The 4 two-pass errors are all cases where haiku's back-translation loses important semantic content (multiset partition logic, WIP threshold semantics). These could potentially be addressed by using a stronger informalization model on hard domains, at the cost of more anchoring risk if the model is "too smart" and infers the requirement.

## Demo: Election Tally

The election domain (11 requirement-lemma pairs) serves as the primary demo. Two variants:

- **election0** (buggy): 9 confirmed, 2 disputed. Claimcheck catches:
  - `OrderIrrelevant` — narrowed scope: lemma only proves prepend == append for a single ballot, not arbitrary reorderings
  - `TallyMonotonic` — wrong property: lemma proves `Count(...) >= 0` (trivially true) instead of monotonicity
- **election** (fixed): 11/11 confirmed after fixing both lemmas
