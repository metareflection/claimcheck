# Claimcheck Results — election0.dfy (original version)

Dafny verification: **14 verified, 0 errors**
Claimcheck audit: **9 confirmed, 2 disputed, 0 errors**

---

## Dispute 1: `OrderIrrelevant` — narrowed-scope

**Requirement:** "The order in which ballots are counted does not affect the final tally"

**Lemma:**
```dafny
lemma OrderIrrelevant(ballots: seq<int>, v: int, c: int)
  ensures Count([v] + ballots, c) == Count(ballots + [v], c)
```

**Claimcheck's verdict:**

> The lemma only proves that prepending versus appending a single ballot yields
> the same count, which is a very narrow case. The requirement states that "the
> order in which ballots are counted does not affect the final tally", which
> should mean that ANY permutation of the ballot sequence yields the same count.
> This lemma does not establish general order-irrelevance.

**Commentary:** This was *not* an intentionally planted weakness — I wrote it
thinking prepend-vs-append was a reasonable proxy for order-irrelevance. It
isn't. The requirement demands full permutation invariance: for any two
sequences with the same ballots in any order, the tally is identical. The lemma
only covers one specific reordering (moving one element from end to front).

**Fix applied in election.dfy:** Introduced a helper `CountEqualsMultiplicity`
that connects `Count` to Dafny's built-in `multiset` multiplicity, then
restated the lemma as:

```dafny
lemma OrderIrrelevant(a: seq<int>, b: seq<int>, c: int)
  requires multiset(a) == multiset(b)
  ensures Count(a, c) == Count(b, c)
```

This captures the full requirement: any two ballot sequences that are
permutations of each other (same multiset) yield the same count.

---

## Dispute 2: `TallyMonotonic` — wrong-property

**Requirement:** "Adding a ballot to the election cannot cause any candidate's tally to decrease"

**Lemma:**
```dafny
lemma TallyMonotonic(ballots: seq<int>, v: int, c: int)
  ensures Count(ballots + [v], c) >= 0
```

**Claimcheck's verdict:**

> The lemma only ensures that the count is non-negative after adding a ballot,
> which is trivially true since counts are always non-negative. The requirement
> states that adding a ballot "cannot cause any candidate's tally to decrease",
> which should be expressed as Count(ballots + [v], c) >= Count(ballots, c).
> The lemma completely misses the comparison between before and after states.

**Commentary:** This was an intentionally planted weakness. The postcondition
`>= 0` is a tautology — `Count` returns `nat`, so it's always non-negative
regardless. The requirement asks for *monotonicity*: a comparison between the
tally before and after adding a ballot. The lemma proves a completely unrelated
(and trivial) property. Claimcheck correctly classified this as `wrong-property`
rather than `weakened-postcondition`, which is the right call — it's not a
weaker version of monotonicity, it's a different statement entirely.

**Fix applied in election.dfy:** Removed this claim entirely (the property
is already implied by `VoteIncrement` and `VoteNoEffect` together).
