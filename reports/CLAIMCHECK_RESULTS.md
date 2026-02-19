# Claimcheck Audit Results

Core task: given a Dafny lemma and a natural-language requirement, does the lemma actually express what the requirement says? 36 requirement-lemma pairs across 5 domains, including 8 deliberately bogus lemmas (tautologies, weakened postconditions, narrowed scope, wrong properties).

## Accuracy

| Variant | Accuracy | Runs | Time/run | API calls/run |
|---------|----------|------|----------|---------------|
| **Two-pass** (default) | **99.1%** (107/108) | 3 | ~41s | 2 (batch) |
| Two-pass (haiku→opus) | 97.2% (105/108) | 3 | ~44s | 2 (batch) |
| Two-pass (haiku→haiku) | 96.3% (104/108) | 3 | ~26s | 2 (batch) |
| Two-pass (opus→opus) | 95.4% (103/108) | 3 | ~65s | 2 (batch) |
| Naive (Opus) | 94.4% (102/108) | 3 | ~107s | 36 |
| Two-pass (sonnet→sonnet) | 94.4% (102/108) | 3 | ~56s | 2 (batch) |
| Naive (Sonnet) | 88.9% (96/108) | 3 | ~147s | 36 |
| Single-prompt | 86.1% (31/36) | 1 | ~353s | 36 |
| Claude Code | 69.4% (25/36) | 1 | ~693s | 36 |

Model: `claude-sonnet-4-5-20250929` unless noted. Two-pass default uses haiku for informalization, sonnet for comparison. Notation: informalize→compare.

## Per-Domain Breakdown

```
                                              exp    H→S      H→O      H→H      S→S      O→O      single   naive/S  naive/O    cc
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

canon (6 pairs, 2 bogus)
  AddExistingNodeIsNoop                        ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  ConstraintTargetsExist                       ok     3/3      3/3      3/3      3/3      2/3 ↓    1/1      3/3      3/3      1/1
  ConstraintTargetsExistEmpty                bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  EdgeEndpointsExist                           ok     3/3      3/3      3/3      3/3      2/3 ↓    1/1      3/3      3/3      0/1 ↓
  RemoveNodeCleansUp                           ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  RemoveNodeDropsId                          bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
                                                      18/18    18/18    18/18    18/18    16/18    6/6      18/18    18/18    5/6

colorwheel (7 pairs, 1 bogus)
  AllColorsValid                               ok     3/3      3/3      3/3      3/3      3/3      1/1      0/3 ↓    3/3      0/1 ↓
  AlwaysFiveColors                             ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      0/1 ↓
  BaseHueInRange                               ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      0/1 ↓
  ContrastPairIndicesValid                     ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  HuesFollowHarmony                            ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      0/1 ↓
  MoodConstraintsSatisfied                     ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  PaletteNonEmpty                            bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
                                                      21/21    21/21    21/21    21/21    21/21    7/7      18/21    21/21    3/7

counter (7 pairs, 3 bogus)
  CounterNonNegative                           ok     3/3      3/3      3/3      3/3      3/3      0/1 ↓    0/3 ↓    3/3      1/1
  InitSatisfiesInvariant                       ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  StepPreservesInvariant                       ok     3/3      3/3      3/3      3/3      3/3      0/1 ↓    3/3      3/3      1/1
  DecAtZeroKeepsZero                           ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  CounterLowerBound                          bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  CounterNonNegAlt                           bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  CounterNonNegLarge                         bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
                                                      21/21    21/21    21/21    21/21    21/21    6/7      18/21    21/21    7/7

delegation-auth (7 pairs, 1 bogus)
  GrantSubjectsExist                           ok     3/3      3/3      3/3      3/3      2/3 ↓    0/1 ↓    0/3 ↓    0/3 ↓    0/1 ↓
  DelegationEndpointsExist                     ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      0/1 ↓
  EdgeIdsFresh                                 ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  GrantNonExistentIsNoop                       ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  DelegateNonExistentIsNoop                    ok     3/3      0/3 ↓    3/3      3/3      1/3 ↓    0/1 ↓    0/3 ↓    0/3 ↓    0/1 ↓
  RevokeNonExistentIsNoop                      ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  GrantNonExistentIsNoopInit                 bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
                                                      21/21    18/21    21/21    21/21    18/21    5/7      15/21    15/21    4/7

kanban (9 pairs, 2 bogus)
  ColumnsAreUnique                             ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  CardInExactlyOneColumn                       ok     2/3      3/3      2/3      0/3 ↓    3/3      0/1      3/3      3/3      0/1
  NoCardDuplicates                             ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  WipLimitsRespected                           ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      0/1 ↓
  AddCardToFullColumnIsNoop                    ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  AllocatorAlwaysFresh                         ok     3/3      3/3      3/3      0/3 ↓    3/3      1/1      3/3      3/3      0/1 ↓
  LanesAndWipMatchColumns                      ok     3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  MoveCardPreservesTotal                     bogus    3/3      3/3      3/3      3/3      3/3      1/1      3/3      3/3      1/1
  CardPartitionNoDups                        bogus    3/3      3/3      0/3 ↓    3/3      3/3      1/1      3/3      3/3      1/1
                                                      26/27    27/27    23/27    21/27    27/27    7/9      27/27    27/27    6/9
```

## What Two-Pass Gets Wrong

Only 1 error in 108 judgments:

- **CardInExactlyOneColumn** (2/3): The lemma expresses a partition property using multiset cardinality. The informalization step occasionally fails to recover the "exactly one column" phrasing from the multiset math — it describes membership without exclusivity. This is a genuine informalization difficulty, not an anchoring problem.

All 8 bogus lemmas were correctly flagged as disputed in all 3 runs (24/24).

## What Two-Pass (Haiku→Opus) Gets Wrong

3 errors in 108 judgments — worse than haiku→sonnet despite a stronger compare model:

- **delegation-auth/DelegateNonExistentIsNoop** (0/3): Opus's compare step consistently false-disputes this valid lemma. The same lemma is 3/3 with sonnet compare. Opus is too aggressive when evaluating delegation-auth invariant structure.

All 8 bogus lemmas correctly flagged (24/24).

## What Two-Pass (Haiku→Haiku) Gets Wrong

4 errors in 108 judgments — and a qualitatively new failure mode:

- **kanban/CardInExactlyOneColumn** (2/3): Same multiset partition difficulty as haiku→sonnet.
- **kanban/CardPartitionNoDups** (0/3): This is a **bogus lemma that haiku fails to catch** in all 3 runs. This is the only variant where a bogus lemma passes undetected. Haiku's compare step is too credulous — it accepts a weakened postcondition that sonnet and opus correctly reject.

## What Two-Pass (Sonnet→Sonnet) Gets Wrong

6 errors in 108 judgments, all on kanban. All errors are false disputes of valid lemmas:

- **kanban/CardInExactlyOneColumn** (0/3): Consistently fails to recover partition semantics from multiset cardinality — same difficulty as haiku, but worse.
- **kanban/AllocatorAlwaysFresh** (0/3): Sonnet over-specifies the allocator invariant in its back-translation, giving the compare step enough surface area to find spurious discrepancies.

Notably, sonnet→sonnet now gets canon right (3/3 on both ConstraintTargetsExist and EdgeEndpointsExist) — the literal informalization instruction prevents the interpretive nuance that previously caused false disputes there. But it trades this for worse kanban performance.

## What Two-Pass (Opus→Opus) Gets Wrong

5 errors in 108 judgments across canon and delegation-auth:

- **canon/ConstraintTargetsExist** (2/3) and **canon/EdgeEndpointsExist** (2/3): Opus's informalization still occasionally adds interpretive nuance on these invariant-heavy lemmas, though the literal instruction improves them from 0/3 to 2/3.
- **delegation-auth/DelegateNonExistentIsNoop** (1/3) and **delegation-auth/GrantSubjectsExist** (2/3): The opus compare step is too aggressive on delegation-auth lemmas involving invariant structure.

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

**Literal informalization is the single biggest improvement.** Adding "Translate the formal specification to natural language as literally as possible" to the informalize prompt pushed the default two-pass from 96.3% to 99.1% — fixing WipLimitsRespected entirely and mostly fixing CardInExactlyOneColumn (0/3 → 2/3). The instruction works best on haiku, whose simpler back-translations benefit most from being steered toward literalness. Sonnet and opus also improve, but less cleanly — sonnet trades canon fixes for kanban regressions; opus partially fixes canon but regresses on delegation-auth.

**Structural separation still matters.** The gap between two-pass (99.1%) and naive Sonnet (88.9%) shows that forcing blind informalization via separate API calls avoids anchoring. Even naive Opus (94.4%) can't match the default two-pass.

**The compare model's calibration matters more than its capability.** The compare prompt says "be strict" — each model interprets that differently. Opus takes it too seriously and false-disputes valid lemmas (97.2%); haiku takes it too lightly and misses a bogus lemma (96.3%); sonnet lands in the sweet spot (99.1%). This is a precision/recall tradeoff that the prompt can't fully control. It likely reflects under-specification in the compare prompt rather than a fundamental property of the models — with more precise guidance on what counts as a discrepancy (e.g. examples of matches vs mismatches), opus would probably be the best comparator, which would be the less surprising outcome.

**GrantSubjectsExist and DelegateNonExistentIsNoop are irreducibly hard for single-call variants.** Every single-call variant (naive, single-prompt, Claude Code) across both Sonnet and Opus gets these two delegation-auth lemmas wrong. Only two-pass with structural separation gets them right — unless opus does the comparison, in which case DelegateNonExistentIsNoop fails again (0/3).

**Bogus detection is easy; valid confirmation is hard — with one exception.** All variants catch bogus lemmas reliably (8/8) except haiku→haiku, which misses CardPartitionNoDups (0/3). This shows that the compare step needs at least sonnet-level capability to reliably reject weakened postconditions.

**Batching is a free lunch.** Two-pass makes 2 API calls per run vs 36. It's both more accurate and faster. The batch informalize call processes all lemmas at once without cross-contamination, because each lemma is independent.

## Demo: Election Tally

The election domain (11 requirement-lemma pairs) serves as the primary demo. Two variants:

- **election0** (buggy): 9 confirmed, 2 disputed. Claimcheck catches:
  - `OrderIrrelevant` — narrowed scope: lemma only proves prepend == append for a single ballot, not arbitrary reorderings
  - `TallyMonotonic` — wrong property: lemma proves `Count(...) >= 0` (trivially true) instead of monotonicity
- **election** (fixed): 11/11 confirmed after fixing both lemmas
