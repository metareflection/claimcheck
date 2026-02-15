/*
 * Verified Election Tally System
 *
 * Models a simple election: voters cast integer-valued ballots for
 * candidates, and we verify properties of the tallying process.
 */

// Count occurrences of `candidate` in the ballot sequence
function Count(ballots: seq<int>, candidate: int): nat
{
  if ballots == [] then 0
  else (if ballots[0] == candidate then 1 else 0) + Count(ballots[1..], candidate)
}

// ── Fundamental properties ──────────────────────────────────────

lemma CountBounded(ballots: seq<int>, c: int)
  ensures Count(ballots, c) <= |ballots|
{
  if ballots != [] { CountBounded(ballots[1..], c); }
}

lemma EmptyElection(c: int)
  ensures Count([], c) == 0
{}

lemma SingleBallotFor(c: int)
  ensures Count([c], c) == 1
{}

lemma SingleBallotAgainst(c: int, other: int)
  requires c != other
  ensures Count([c], other) == 0
{}

// ── Effect of casting a vote ────────────────────────────────────

lemma VoteIncrement(ballots: seq<int>, c: int)
  ensures Count(ballots + [c], c) == Count(ballots, c) + 1
{
  if ballots != [] {
    VoteIncrement(ballots[1..], c);
    assert ballots + [c] == [ballots[0]] + (ballots[1..] + [c]);
  }
}

lemma VoteNoEffect(ballots: seq<int>, c: int, other: int)
  requires c != other
  ensures Count(ballots + [other], c) == Count(ballots, c)
{
  if ballots != [] {
    VoteNoEffect(ballots[1..], c, other);
    assert ballots + [other] == [ballots[0]] + (ballots[1..] + [other]);
  }
}

// ── Aggregation ─────────────────────────────────────────────────

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

// ── Unanimity ───────────────────────────────────────────────────

lemma UnanimousTally(ballots: seq<int>, c: int)
  requires forall i :: 0 <= i < |ballots| ==> ballots[i] == c
  ensures Count(ballots, c) == |ballots|
{
  if ballots != [] { UnanimousTally(ballots[1..], c); }
}

lemma UnanimousExclusion(ballots: seq<int>, c: int, other: int)
  requires forall i :: 0 <= i < |ballots| ==> ballots[i] == c
  requires other != c
  ensures Count(ballots, other) == 0
{
  if ballots != [] { UnanimousExclusion(ballots[1..], c, other); }
}

// ── Monotonicity ────────────────────────────────────────────────

lemma TallyMonotonic(ballots: seq<int>, v: int, c: int)
  ensures Count(ballots + [v], c) >= Count(ballots, c)
{
  if v == c { VoteIncrement(ballots, c); }
  else      { VoteNoEffect(ballots, c, v); }
}

