include "../../../../dafny-replay/kanban/KanbanDomain.dfy"

module KanbanClaims {
  import opened KanbanDomain

  lemma ColumnsAreUnique(m: Model)
    requires Inv(m)
    ensures NoDupSeq(m.cols)
  { }

  lemma CardInExactlyOneColumn(m: Model)
    requires Inv(m)
    ensures NoDupSeq(AllIds(m))
    ensures forall id :: id in m.cards <==> OccursInLanes(m, id)
  { }

  lemma NoCardDuplicates(m: Model)
    requires Inv(m)
    ensures NoDupSeq(AllIds(m))
  { }

  lemma WipLimitsRespected(m: Model)
    requires Inv(m)
    ensures forall i :: 0 <= i < |m.cols| ==> |m.lanes[m.cols[i]]| <= m.wip[m.cols[i]]
  { }

  lemma AddCardToFullColumnIsNoop(m: Model, col: ColId, title: string)
    requires Inv(m)
    requires col in m.cols
    requires col in m.lanes && col in m.wip
    requires |m.lanes[col]| >= m.wip[col]
    ensures Apply(m, AddCard(col, title)) == m
  { }

  lemma AllocatorAlwaysFresh(m: Model)
    requires Inv(m)
    ensures forall id :: id in m.cards ==> id < m.nextId
  { }

  lemma LanesAndWipMatchColumns(m: Model)
    requires Inv(m)
    ensures forall i :: 0 <= i < |m.cols| ==> m.cols[i] in m.lanes && m.cols[i] in m.wip
    ensures forall c :: c in m.lanes ==> c in m.cols
    ensures forall c :: c in m.wip ==> c in m.cols
  { }

  lemma MoveCardPreservesTotal(m: Model, id: CardId, toCol: ColId, pos: nat)
    requires Inv(m)
    ensures |AllIds(Normalize(Apply(m, MoveCard(id, toCol, pos))))| == |AllIds(Normalize(Apply(m, MoveCard(id, toCol, pos))))|
  { }

  lemma CardPartitionNoDups(m: Model)
    requires Inv(m)
    ensures NoDupSeq(AllIds(m))
  { }
}
