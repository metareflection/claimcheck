# ClaimCheck on VERINA: Lean 4 Specification Verification

Model: `claude-sonnet-4-5-20250929` (two-pass informalization: `claude-haiku-4-5-20251001`) | Date: 2026-02-17

## TL;DR

We ran ClaimCheck on all 189 VERINA tasks — Lean 4 formal specifications paired with natural language descriptions. Since all pairs are intended to be correct, the confirmation rate measures specificity (1 - false positive rate). Baseline confirms 57.1%, two-pass confirms 54.0%. The modes agree on 89.4% of tasks. Roughly 15-20 disputes are genuine spec weaknesses in VERINA (truncated postconditions, tautologies, semantic mismatches), while 30-40 are false positives from overly strict checking. Two-pass provides useful dispute categorization and occasionally catches issues baseline misses (e.g., a left-vs-right rotation bug), but is slightly more aggressive overall.

## Dataset

[VERINA](https://arxiv.org/abs/2505.23135) is a benchmark of 189 manually curated coding tasks in Lean 4, each with a detailed NL description, formal specification (precondition + postcondition), reference implementation, and proof attempt.

- **108 basic** tasks: simple functions (abs, swap, isPalindrome, isEven)
- **81 advanced** tasks: algorithms (LIS, majority element, merge intervals, two-sum)
- Sources: MBPP-DFY-50 (49 tasks translated from Dafny), CloverBench (59 tasks), additional human-authored

Unlike VeriCoding (competitive programming, auto-generated specs), VERINA has human-curated NL descriptions averaging ~110 words and manually written specifications. However, the specs have real quality variance — some advanced postconditions are truncated or semantically incomplete.

## Method

Both modes check whether the Lean 4 specification (precondition + postcondition) faithfully captures the NL description. The code body and proof are excluded — only the spec contract is checked.

**Baseline**: Single LLM call. Sonnet reads both the NL description and the Lean spec, informalizes the spec, compares, and produces a CONFIRMED/DISPUTED verdict.

**Two-pass**: Pass 1 (Haiku): Informalize the Lean spec to English *without seeing the NL description*. Pass 2 (Sonnet): Compare the blind back-translation against the NL description. Produces a verdict plus a `weakeningType` categorization.

## Results

### Top-Level

| | Baseline | Two-Pass |
|---|---|---|
| Confirmed | 108 / 189 (57.1%) | 102 / 189 (54.0%) |
| Disputed | 81 / 189 (42.9%) | 87 / 189 (46.0%) |
| Errors | 0 | 0 |
| Elapsed | 201s | 196s |

### By Subset

| Subset | Baseline Confirmed | Two-Pass Confirmed |
|---|---|---|
| Basic (108) | 61 (56.5%) | 61 (56.5%) |
| Advanced (81) | 47 (58.0%) | 41 (50.6%) |

Two-pass is more aggressive on advanced tasks (6 more disputes). Basic counts are coincidentally identical at the aggregate level, though not on the same tasks.

### Agreement

| | Count | % |
|---|---|---|
| Both confirmed | 95 | 50.3% |
| Both disputed | 74 | 39.2% |
| Baseline confirmed, two-pass disputed | 13 | 6.9% |
| Baseline disputed, two-pass confirmed | 7 | 3.7% |
| **Total agreement** | **169** | **89.4%** |

### Two-Pass Dispute Categories

| Type | Count | Basic | Advanced |
|---|---|---|---|
| wrong-property | 38 | 25 | 13 |
| weakened-postcondition | 30 | 13 | 17 |
| tautology | 7 | 0 | 7 |
| narrowed-scope | 6 | 6 | 0 |
| missing-case | 4 | 1 | 3 |
| none | 2 | 2 | 0 |

Notable: all 7 tautology disputes are advanced tasks with genuinely empty or vacuous postconditions. All 6 narrowed-scope disputes are basic tasks with overly restrictive preconditions (e.g., requiring non-empty arrays when the NL handles empty).

## Dispute Analysis

### Genuine Spec Weaknesses (~15-20 tasks)

VERINA has real quality issues, concentrated in the advanced subset:

**Truncated / empty postconditions:** Several advanced specs have postconditions that are literally incomplete — they define local variables but never assert anything. Both modes correctly dispute these.

- `isPeakValley` — postcondition cut off mid-definition
- `lengthOfLIS` — helper function defined but never used to constrain result
- `longestConsecutive` — postcondition defined twice, both incomplete
- `minimumRightShifts` — postcondition is only `let n := nums.length`
- `removeElement` — postcondition contains only comments
- `minOperations` — let bindings with no conclusion

**Semantic mismatches:**

- `firstDuplicate` — spec finds "first element that is duplicated" (earliest position in list with count > 1), not "first element encountered for the second time" during left-to-right scan. For `[2, 1, 3, 1, 2]`: spec returns 2, NL expects 1.
- `mergeIntervals` — spec only checks that input intervals are "covered" by result intervals. Missing: non-overlapping, sorted, minimal. A single `[MIN, MAX]` interval would satisfy the postcondition.
- `moveZeroes` — spec checks subsequence property but not that zeros are moved to the end.
- `mergeSorted` — NL says elements "included once and only once" (set union), but spec uses permutation (multiset merge).

**Tautologies:**

- `findMajorityElement` — the `result = -1` branch is `no_majority OR majority`, which is always true. The spec allows returning -1 even when a majority exists.

### Two-Pass Exclusive Catches (13 tasks)

Tasks that baseline confirmed but two-pass disputed. Best catch:

- `rotateRight` — spec uses formula `(i - n + len) % len` which is LEFT rotation. NL says "rotate right." Baseline missed this; two-pass caught it via the blind informalization step, which described the rotation direction without NL bias.

Of the 13, roughly 2-3 are genuinely interesting catches, 4-5 are arguable, and the rest are false positives (e.g., disputing a spec for being *stronger* than required).

### Baseline Exclusive Catches (7 tasks)

Tasks that baseline disputed but two-pass confirmed. Most of these are baseline false positives that two-pass correctly filtered:

- `swap` — baseline disputed because postcondition didn't state array size explicitly (implied).
- `ComputeIsEven` — baseline disputed over a mathematical definition vs. NL phrasing difference.
- `only_once` — baseline claimed a "critical logical error" in a biconditional that is actually correct.

### False Positives (~30-40 tasks)

The largest category. Common patterns:

- **Redundant strengthening**: Spec proves more than NL asks. Tool disputes because the formulations differ, even though the spec is strictly stronger.
- **Equivalent formulations**: Different but logically equivalent ways of stating the same property.
- **Type pedantry**: Nat vs Int when mathematically equivalent in context.
- **Implementation-level concerns**: Worrying about indexing safety that is implied by preconditions.

### Model Self-Contradiction

One anomaly: `isPowerOfTwo` (two-pass). The comparison explanation concludes "the specification faithfully expresses the description's requirements" but still sets `match: false` and `weakeningType: none`. The model's reasoning and verdict diverge — a known failure mode of structured output where the reasoning is sound but the boolean field is wrong.

## Comparison with Other Benchmarks

| Benchmark | Language | Tasks | Confirmation Rate | Notes |
|---|---|---|---|---|
| ClaimCheck (custom) | Dafny | 36 | 96.3% (two-pass) | Hand-crafted, includes bogus lemmas, measures accuracy |
| VeriCoding | Dafny | 5 (test) | 60% (single-prompt) | Competitive programming, many weak specs |
| **VERINA** | **Lean 4** | **189** | **54-57%** | **Human-curated, real quality variance** |

VERINA's lower confirmation rate reflects both genuine spec weaknesses (~10% of tasks) and a high false positive rate (~30%). The ClaimCheck custom benchmark is much smaller but has deliberate bogus examples, making it a better test of recall. VERINA is better for testing specificity at scale.

## Takeaways

1. **VERINA has genuine spec quality issues.** ~15-20 of 189 tasks have incomplete, vacuous, or semantically incorrect postconditions. This makes it more interesting than VeriCoding for benchmarking.

2. **False positive rate is too high.** Both modes dispute 40-46% of tasks, but only ~20% of disputes are clearly justified. The tool is too trigger-happy, particularly on specs that use different-but-equivalent formulations.

3. **Two-pass adds value via categorization.** The `weakeningType` field makes disputes actionable. Baseline disputes are opaque ("unknown" type). Two-pass tells you *why* it disagrees.

4. **Two-pass is not strictly better.** It catches some issues baseline misses (rotateRight), but introduces new false positives. The blind informalization step (Haiku) adds an interpretation layer that can overcomplicate comparisons.

5. **The basic/advanced split is informative.** Basic specs are simpler and better-written. Advanced specs have more truncated postconditions and semantic mismatches. Future work should focus on reducing false positives on basic tasks (currently 43.5% dispute rate on presumably-correct simple specs).

6. **Lean support works.** The ClaimCheck round-trip approach transfers from Dafny lemmas to Lean precond/postcond with minimal adaptation. The prompts needed only terminology changes, not structural changes.
