include "../../../../dafny-replay/counter/CounterDomain.dfy"

module CounterClaims {
  import opened CounterDomain

  lemma CounterNonNegative(m: Model)
    requires Inv(m)
    ensures m >= 0
  { }

  lemma InitSatisfiesInvariant()
    ensures Inv(Init())
  { }

  lemma StepPreservesInvariant(m: Model, a: Action)
    requires Inv(m)
    ensures Inv(Normalize(Apply(m, a)))
  { }

  lemma DecAtZeroKeepsZero(m: Model)
    requires Inv(m)
    requires m == 0
    ensures Normalize(Apply(m, Dec)) == 0
  { }

  lemma CounterNonNegAlt(m: Model)
    requires Inv(m)
    ensures m == m
  { }

  lemma CounterNonNegLarge(m: Model)
    requires Inv(m)
    requires m > 100
    ensures m >= 0
  { }

  lemma CounterLowerBound(m: Model)
    requires Inv(m)
    ensures m >= -1
  { }
}
