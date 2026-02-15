# Audit Report: election0

## Summary

- **Mappings audited:** 11
- **Confirmed:** 9
- **Disputed:** 2

## Confirmed Mappings

**No candidate can receive more votes than the total number of ballots cast**
- Lemma: `CountBounded`
- Back-translation: The count of ballots for any candidate is at most the total number of ballots.
```dafny
lemma CountBounded(ballots: seq<int>, c: int)
  ensures Count(ballots, c) <= |ballots|
{
  if ballots != [] { CountBounded(ballots[1..], c); }
}
```

**In an empty election with no ballots, every candidate has zero votes**
- Lemma: `EmptyElection`
- Back-translation: The count of votes for any candidate in an empty ballot sequence is zero.
```dafny
lemma EmptyElection(c: int)
  ensures Count([], c) == 0
{}
```

**A single ballot cast for a candidate gives that candidate exactly one vote**
- Lemma: `SingleBallotFor`
- Back-translation: A single ballot cast for candidate c results in a count of 1 for that candidate.
```dafny
lemma SingleBallotFor(c: int)
  ensures Count([c], c) == 1
{}
```

**A single ballot cast for one candidate gives every other candidate zero votes**
- Lemma: `SingleBallotAgainst`
- Back-translation: A single ballot cast for candidate c results in a count of 0 for any other candidate.
```dafny
lemma SingleBallotAgainst(c: int, other: int)
  requires c != other
  ensures Count([c], other) == 0
{}
```

**Casting a ballot for a candidate increases that candidate's tally by exactly one**
- Lemma: `VoteIncrement`
- Back-translation: Adding a ballot for candidate c to a ballot sequence increases the count for c by exactly 1.
```dafny
lemma VoteIncrement(ballots: seq<int>, c: int)
  ensures Count(ballots + [c], c) == Count(ballots, c) + 1
{
  if ballots != [] {
    VoteIncrement(ballots[1..], c);
    assert ballots + [c] == [ballots[0]] + (ballots[1..] + [c]);
  }
}
```

**Casting a ballot for one candidate does not change any other candidate's tally**
- Lemma: `VoteNoEffect`
- Back-translation: Adding a ballot for a different candidate does not change the count for candidate c.
```dafny
lemma VoteNoEffect(ballots: seq<int>, c: int, other: int)
  requires c != other
  ensures Count(ballots + [other], c) == Count(ballots, c)
{
  if ballots != [] {
    VoteNoEffect(ballots[1..], c, other);
    assert ballots + [other] == [ballots[0]] + (ballots[1..] + [other]);
  }
}
```

**Merging two ballot boxes produces a tally equal to the sum of the individual tallies**
- Lemma: `CombineTallies`
- Back-translation: The count of votes for candidate c in the concatenation of two ballot sequences equals the sum of the counts in each sequence.
```dafny
lemma CombineTallies(a: seq<int>, b: seq<int>, c: int)
  ensures Count(a + b, c) == Count(a, c) + Count(b, c)
{
  if a == [] {
    assert a + b == b;
  } else {
    CombineTallies(a[1..], b, c);
    assert a + b == [a[0]] + (a[1..] + b);
  }
}
```

**In a unanimous election, the winning candidate's tally equals the total number of ballots**
- Lemma: `UnanimousTally`
- Back-translation: If all ballots in a sequence are for candidate c, then the count for c equals the total number of ballots.
```dafny
lemma UnanimousTally(ballots: seq<int>, c: int)
  requires forall i :: 0 <= i < |ballots| ==> ballots[i] == c
  ensures Count(ballots, c) == |ballots|
{
  if ballots != [] { UnanimousTally(ballots[1..], c); }
}
```

**In a unanimous election, every other candidate receives zero votes**
- Lemma: `UnanimousExclusion`
- Back-translation: If all ballots in a sequence are for candidate c, then the count for any other candidate is zero.
```dafny
lemma UnanimousExclusion(ballots: seq<int>, c: int, other: int)
  requires forall i :: 0 <= i < |ballots| ==> ballots[i] == c
  requires other != c
  ensures Count(ballots, other) == 0
{
  if ballots != [] { UnanimousExclusion(ballots[1..], c, other); }
}
```

## Disputed Mappings

**The order in which ballots are counted does not affect the final tally**
- Lemma: `OrderIrrelevant`
- Discrepancy: The lemma only proves that prepending versus appending a single ballot produces the same count, but the requirement asks for the stronger property that ANY reordering of ballots produces the same tally. This is a much narrower scope than what the requirement demands.
- Weakening: narrowed-scope
- Back-translation: Prepending a ballot for candidate v to a sequence produces the same count as appending it, for any candidate c.
```dafny
lemma OrderIrrelevant(ballots: seq<int>, v: int, c: int)
  ensures Count([v] + ballots, c) == Count(ballots + [v], c)
{
  CombineTallies([v], ballots, c);
  CombineTallies(ballots, [v], c);
}
```

**Adding ballots can't decrease a tally**
- Lemma: `TallyMonotonic`
- Discrepancy: The lemma only proves that the count is non-negative (>= 0), which is trivially true for any count. The requirement asks that 'adding ballots can't decrease a tally', which should compare Count(ballots, c) <= Count(ballots + [v], c), showing monotonicity. The lemma proves something much weaker and unrelated.
- Weakening: wrong-property
- Back-translation: The count of votes for any candidate after appending a ballot is non-negative.
```dafny
lemma TallyMonotonic(ballots: seq<int>, v: int, c: int)
  ensures Count(ballots + [v], c) >= 0
{}
```

---
*API usage: 5819 input tokens, 2778 output tokens*
