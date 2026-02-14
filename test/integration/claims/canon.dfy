include "../../../../dafny-replay/canon/CanonDomain.dfy"
include "../../../../dafny-replay/canon/Canon.dfy"

module CanonClaims {
  import opened CanonDomain
  import C = Canon

  lemma ConstraintTargetsExist(m: Model)
    requires Inv(m)
    ensures C.AllConstraintsValid(m.constraints, m.nodes)
  { }

  lemma EdgeEndpointsExist(m: Model)
    requires Inv(m)
    ensures C.AllEdgesValid(m.edges, m.nodes)
  { }

  lemma AddExistingNodeIsNoop(m: Model, id: C.NodeId, x: int, y: int)
    requires Inv(m)
    requires id in m.nodes
    ensures Apply(m, AddNode(id, x, y)) == m
  { }

  lemma RemoveNodeCleansUp(m: Model, id: C.NodeId)
    requires Inv(m)
    requires id in m.nodes
    ensures id !in Normalize(Apply(m, RemoveNode(id))).nodes
    ensures C.NoneMatch(Normalize(Apply(m, RemoveNode(id))).constraints, id)
    ensures C.NoEdgesMention(Normalize(Apply(m, RemoveNode(id))).edges, id)
  {
    C.ShrinkConstraintsSpec(m.constraints, id, 0, [], m.nodes);
    C.FilterOutIncidentEdgesSpec(m.edges, id, 0, [], m.nodes);
  }

  lemma RemoveNodeDropsId(m: Model, id: C.NodeId)
    requires Inv(m)
    requires id in m.nodes
    ensures id !in Normalize(Apply(m, RemoveNode(id))).nodes
  { }

  lemma ConstraintTargetsExistEmpty(m: Model)
    requires Inv(m)
    requires |m.constraints| == 0
    ensures C.AllConstraintsValid(m.constraints, m.nodes)
  { }
}
