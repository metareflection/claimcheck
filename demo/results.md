# Audit Report: election

## Summary

- **Mappings audited:** 11
- **Confirmed:** 11

## Confirmed Mappings

**No candidate can receive more votes than the total number of ballots cast**
- Lemma: `CountBounded`
- Back-translation: For any sequence of ballots and any candidate, the count of votes for that candidate is at most the total number of ballots.
```dafny
lemma CountBounded(ballots: seq<int>, c: int)
  ensures Count(ballots, c) <= |ballots|
{
  if ballots != [] { CountBounded(ballots[1..], c); }
}
```

**In an empty election with no ballots, every candidate has zero votes**
- Lemma: `EmptyElection`
- Back-translation: For any candidate, counting votes in an empty ballot sequence yields zero votes.
```dafny
lemma EmptyElection(c: int)
  ensures Count([], c) == 0
{}
```

**A single ballot cast for a candidate gives that candidate exactly one vote**
- Lemma: `SingleBallotFor`
- Back-translation: For any candidate, counting votes in a single-ballot sequence containing that candidate yields exactly one vote.
```dafny
lemma SingleBallotFor(c: int)
  ensures Count([c], c) == 1
{}
```

**A single ballot cast for one candidate gives every other candidate zero votes**
- Lemma: `SingleBallotAgainst`
- Back-translation: For any two distinct candidates, counting votes for one candidate in a single-ballot sequence containing the other candidate yields zero votes.
```dafny
lemma SingleBallotAgainst(c: int, other: int)
  requires c != other
  ensures Count([c], other) == 0
{}
```

**Casting a ballot for a candidate increases that candidate's tally by exactly one**
- Lemma: `VoteIncrement`
- Back-translation: For any sequence of ballots and any candidate, appending a ballot for that candidate increases the vote count for that candidate by exactly one.
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
- Back-translation: For any sequence of ballots and any two distinct candidates, appending a ballot for one candidate does not change the vote count for the other candidate.
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
- Back-translation: For any two sequences of ballots and any candidate, the vote count for that candidate in the concatenation of the two sequences equals the sum of the vote counts in each sequence separately.
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

**The order in which ballots are counted does not affect the final tally**
- Lemma: `OrderIrrelevant`
- Back-translation: For any two sequences of ballots with the same multiset of elements and any candidate, the vote count for that candidate is the same in both sequences.
```dafny
lemma OrderIrrelevant(a: seq<int>, b: seq<int>, c: int)
  requires multiset(a) == multiset(b)
  ensures Count(a, c) == Count(b, c)
{
  CountEqualsMultiplicity(a, c);
  CountEqualsMultiplicity(b, c);
}
```

**In a unanimous election, the winning candidate's tally equals the total number of ballots**
- Lemma: `UnanimousTally`
- Back-translation: For any sequence of ballots where every ballot is for the same candidate, the vote count for that candidate equals the total number of ballots.
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
- Back-translation: For any sequence of ballots where every ballot is for the same candidate, the vote count for any different candidate is zero.
```dafny
lemma UnanimousExclusion(ballots: seq<int>, c: int, other: int)
  requires forall i :: 0 <= i < |ballots| ==> ballots[i] == c
  requires other != c
  ensures Count(ballots, other) == 0
{
  if ballots != [] { UnanimousExclusion(ballots[1..], c, other); }
}
```

**Adding a ballot to the election cannot cause any candidate's tally to decrease**
- Lemma: `TallyMonotonic`
- Back-translation: For any sequence of ballots, any vote, and any candidate, appending the vote to the sequence does not decrease the vote count for that candidate.
```dafny
lemma TallyMonotonic(ballots: seq<int>, v: int, c: int)
  ensures Count(ballots + [v], c) >= Count(ballots, c)
{
  if v == c { VoteIncrement(ballots, c); }
  else      { VoteNoEffect(ballots, c, v); }
}
```

---
*API usage: 5956 input tokens, 2576 output tokens*
