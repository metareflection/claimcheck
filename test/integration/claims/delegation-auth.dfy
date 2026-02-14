include "../../../../dafny-replay/delegation-auth/DelegationAuthDomain.dfy"

module DelegationAuthClaims {
  import opened DelegationAuthDomain

  lemma GrantSubjectsExist(m: Model)
    requires Inv(m)
    ensures forall sc :: sc in m.grants ==> sc.0 in m.subjects
  { }

  lemma DelegationEndpointsExist(m: Model)
    requires Inv(m)
    ensures forall eid :: eid in m.delegations ==>
        m.delegations[eid].from in m.subjects &&
        m.delegations[eid].to in m.subjects
  { }

  lemma EdgeIdsFresh(m: Model)
    requires Inv(m)
    ensures forall eid :: eid in m.delegations ==> eid < m.nextEdge
  { }

  lemma GrantNonExistentIsNoop(m: Model, s: Subject, cap: Capability)
    requires Inv(m)
    requires s !in m.subjects
    ensures Apply(m, Grant(s, cap)) == m
  { }

  lemma DelegateNonExistentIsNoop(m: Model, from: Subject, to: Subject, cap: Capability)
    requires Inv(m)
    requires !(from in m.subjects && to in m.subjects)
    ensures Apply(m, Delegate(from, to, cap)) == m
  { }

  lemma RevokeNonExistentIsNoop(m: Model, eid: EdgeId)
    requires Inv(m)
    requires eid !in m.delegations
    ensures Apply(m, Revoke(eid)) == m
  { }

  lemma GrantNonExistentIsNoopInit(m: Model, s: Subject, cap: Capability)
    requires Inv(m)
    requires m == Init()
    requires s !in m.subjects
    ensures Apply(m, Grant(s, cap)) == m
  { }
}
