# Claimcheck — Demo Script (1 minute)

## The Problem (15s)

Dafny is a verification language: if your proof compiles, it's mathematically correct. But **correct proof ≠ correct meaning**. A lemma can verify perfectly and still not say what you think it says. Tautologies, narrowed scope, wrong properties — Dafny can't catch these because it doesn't know your *intent*.

Claimcheck fills that gap. It takes your natural-language requirements, takes your Dafny lemmas, and asks: **do these actually match?**

## How It Works (10s)

Round-trip verification in two passes:

1. **Informalize** (Haiku) — reads the Dafny lemma *without* seeing the requirement, translates it back to plain English
2. **Compare** (Sonnet) — checks whether the back-translation matches the original requirement

Different models, no anchoring bias. If the lemma doesn't say what the requirement says, the mismatch surfaces.

## The Demo: Verified Election Tally (35s)

We asked Claude Code to build a verified election tally system — a `Count` function that tallies ballots, with 11 lemmas covering bounds, vote effects, aggregation, unanimity, and monotonicity.

**Step 1: Dafny verifies everything.** 14 verified, 0 errors. Every proof is correct.

**Step 2: Claimcheck audits the claims.** Result: **9 confirmed, 2 disputed.**

### Catch 1 — `OrderIrrelevant` (unintentional, `narrowed-scope`)

- **Requirement:** "Order of ballots doesn't affect the tally"
- **Lemma:** Only proves prepend vs. append give the same count
- **Problem:** That's one specific reordering, not *any* permutation. Looks right at a glance. Dafny doesn't care. Claimcheck caught it.

### Catch 2 — `TallyMonotonic` (intentional trap, `wrong-property`)

- **Requirement:** "Adding a ballot can't decrease a tally"
- **Lemma:** Proves `Count(...) >= 0` — trivially true since counts are natural numbers
- **Problem:** Should compare before vs. after, not just check non-negativity. A tautology masquerading as monotonicity.

**Step 3: Fix and re-run.** Rewrote `OrderIrrelevant` using multisets for full permutation invariance, removed the tautology. Re-ran claimcheck: **10 confirmed, 0 disputed.** One iteration.

## The Tagline

> Dafny proves your code matches your spec. Claimcheck asks whether your spec matches your intent. The gap between them is where bugs hide.

## Category Fit

**Amplify Human Judgment** — Claimcheck doesn't replace the person writing the spec. It catches the subtle gaps between what you meant and what you proved, keeping the human in the loop on what matters: intent.
