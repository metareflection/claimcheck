# Transcript: Building and claimchecking a verified election tally

## Setup

**User:** First, read ../../claimcheck/CLAIMCHECK.md

**Claude:** Read the file. Claimcheck verifies whether Dafny lemmas faithfully express the natural-language requirements they claim to formalize. It takes a mapping JSON and a .dfy file, and rates each claim as confirmed, disputed, or error.

---

## Choosing a problem

**User:** Let's do an interesting dafny program, not too complex, but with lots to prove about it.

**Claude:** Built a **Verified Election Tally System** — a recursive `Count` function that tallies ballots for candidates, with 11 lemmas across 4 categories:

- **Fundamentals**: counts are bounded, empty/single ballot behavior
- **Vote effects**: casting a vote adds exactly 1 to that candidate, leaves others unchanged
- **Aggregation**: merging ballot boxes sums tallies; counting order doesn't matter
- **Unanimity**: if everyone votes the same, winner gets all, others get zero
- **Monotonicity**: adding ballots can't decrease a tally

Included one intentional trap: `TallyMonotonic` only proves `Count(...) >= 0` (a tautology) instead of actual monotonicity.

---

## Verifying the Dafny code

**User:** Did you verify the file?

**Claude:** Ran `dafny verify election.dfy` — **14 verified, 0 errors.**

---

## Running claimcheck

**User:** Now, run claimcheck.

**Claude:** Ran claimcheck. Result: **9 confirmed, 2 disputed, 0 errors.**

### Dispute 1: `TallyMonotonic` (intentional) — `wrong-property`

The lemma proves `Count(ballots + [v], c) >= 0`, which is trivially true. The requirement asks for monotonicity: `>= Count(ballots, c)`. Claimcheck correctly identified this as proving a completely different property.

### Dispute 2: `OrderIrrelevant` (unintentional!) — `narrowed-scope`

The lemma only proves prepend-vs-append equivalence for a single ballot. The requirement says "order doesn't affect the tally," which means any permutation should preserve counts. Claimcheck correctly identified this as proving only a special case.

**Assessment:** Both catches are legitimate. The `OrderIrrelevant` one is especially valuable — it wasn't planted, looked correct at a glance, and passed Dafny verification.

---

## Fixing the disputes

**User:** Do you want to try to fix it? And remove the intentional one.

**Claude:** Two changes:

1. **Removed `TallyMonotonic`** entirely (the property is implied by `VoteIncrement` and `VoteNoEffect` together).

2. **Rewrote `OrderIrrelevant`** to prove full permutation invariance. Added a helper lemma connecting `Count` to Dafny's built-in multiset multiplicity:

```dafny
lemma CountEqualsMultiplicity(ballots: seq<int>, c: int)
  ensures Count(ballots, c) == multiset(ballots)[c]
{
  if ballots != [] {
    CountEqualsMultiplicity(ballots[1..], c);
    assert ballots == [ballots[0]] + ballots[1..];
  }
}

lemma OrderIrrelevant(a: seq<int>, b: seq<int>, c: int)
  requires multiset(a) == multiset(b)
  ensures Count(a, c) == Count(b, c)
{
  CountEqualsMultiplicity(a, c);
  CountEqualsMultiplicity(b, c);
}
```

First attempt at `CountEqualsMultiplicity` failed Dafny verification — needed an assertion hint (`assert ballots == [ballots[0]] + ballots[1..];`) in the inductive case. Second attempt: **14 verified, 0 errors.**

Re-ran claimcheck: **10 confirmed, 0 disputed, 0 errors.** Clean sweep.

---

## Assessment

**User:** Any final conclusions? Would you recommend claimcheck?

**Claude:** Yes. Key observations:

1. **The unplanned catch was the impressive one.** `OrderIrrelevant` is exactly the kind of thing a human reviewer would gloss over — the lemma looks right, Dafny verifies it, and prepend-vs-append *feels* like order-irrelevance. But it isn't.

2. **The classification labels are sharp.** `narrowed-scope` for a special case vs `wrong-property` for a tautology — those distinctions tell you exactly how to fix things.

3. **The fix feedback loop is fast.** Write, run, read discrepancy, fix, re-run. One iteration to 10/10.

**Bottom line:** Dafny proves your code matches your spec. Claimcheck asks whether your spec matches your intent. Those are different questions, and the gap between them is where bugs hide.

---

## Final requirements proved

1. No candidate can receive more votes than the total number of ballots cast
2. In an empty election with no ballots, every candidate has zero votes
3. A single ballot cast for a candidate gives that candidate exactly one vote
4. A single ballot cast for one candidate gives every other candidate zero votes
5. Casting a ballot for a candidate increases that candidate's tally by exactly one
6. Casting a ballot for one candidate does not change any other candidate's tally
7. Merging two ballot boxes produces a tally equal to the sum of the individual tallies
8. The order in which ballots are counted does not affect the final tally
9. In a unanimous election, the winning candidate's tally equals the total number of ballots
10. In a unanimous election, every other candidate receives zero votes

All 10 verified by Dafny and confirmed by claimcheck.
