# claimcheck-demo

A demonstration of [claimcheck](https://github.com/metareflection/claimcheck) — a tool that verifies whether Dafny lemmas actually express the natural-language requirements they claim to formalize.

## The problem

We built a **verified election tally system** in Dafny: a recursive `Count` function that tallies ballots for candidates, with lemmas proving 10 properties about the tallying process.

The properties cover:

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

## What claimcheck caught

The initial version (`election0.dfy`) passed Dafny verification with 0 errors — every proof is correct. But claimcheck found **2 out of 11 claims were unfaithful** to their stated requirements:

**`OrderIrrelevant` (unintentional weakness)** — The lemma only proved that prepending a ballot gives the same count as appending it. The requirement says *order doesn't matter*, which means any permutation should preserve the tally. Claimcheck flagged this as `narrowed-scope`. We fixed it by connecting `Count` to Dafny's built-in `multiset` and proving full permutation invariance.

**`TallyMonotonic` (intentional weakness)** — The lemma proved `Count(ballots + [v], c) >= 0`, which is a tautology (`Count` returns `nat`). The requirement says tallies *cannot decrease*, which requires comparing before and after. Claimcheck flagged this as `wrong-property`. We removed it from the final version since the property is implied by `VoteIncrement` and `VoteNoEffect` together.

The `OrderIrrelevant` catch is the interesting one — it was not planted, looked correct at a glance, and passed Dafny verification. It's exactly the kind of spec-vs-intent gap that's hard to catch in review.

## Files

| File | Description |
|------|-------------|
| `election.dfy` | Final verified program (10 lemmas, all confirmed) |
| `election0.dfy` | Original version with 2 weak lemmas |
| `mapping.json` | Requirement-to-lemma mapping for claimcheck |
| `election0.md` | Detailed claimcheck feedback on the original version |
| `LOG.md` | Audit log from the first claimcheck run |

## Running it

```bash
# Verify the Dafny proofs
dafny verify election.dfy

# Run claimcheck
node ../../claimcheck/bin/claimcheck.js \
  -m mapping.json \
  --dfy election.dfy \
  -d elections \
  --json
```

## Takeaway

Dafny proves your code matches your spec. Claimcheck asks whether your spec matches your intent. Those are different questions, and the gap between them is where bugs hide.
