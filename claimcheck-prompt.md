# Claimcheck: Do Dafny Lemma Contracts Justify Natural Language Claims?

You are reviewing whether verified Dafny lemmas justify the natural language requirements they claim to formalize.

**Key assumption:** The Dafny code is correct and verified. You are NOT auditing the proofs. You are checking whether the lemma contract (requires/ensures) actually says what the natural language claims it says.

You will be given:
1. **Dafny code** containing lemma signatures and surrounding context (type definitions, predicates, invariants)
2. **A mapping** from natural language requirements to lemma names

---

## Analysis (Two Passes)

### Pass 1 — Informalize the Lemma (without reading the NL requirement)

For the lemma, state in plain English:

- **What it guarantees** (ensures clauses, in your own words)
- **Under what conditions** (requires clauses, in your own words — unfold predicates enough to be clear, but invariant dependencies are fine and expected)

Do this BEFORE reading the natural language requirement.

### Pass 2 — Compare

Now read the NL requirement and answer three questions:

**1. Does the ensures clause express the NL claim?**

- **Yes**: The guarantee matches the requirement (it may be stronger, that's fine).
- **Partially**: The guarantee covers some but not all of the NL claim. State what's missing.
- **No**: The guarantee says something different from the NL claim.

Pay attention to: quantifier scope, boundary conditions (`<` vs `<=`), and whether the Dafny formalizes a slightly different concept than the NL intends.

**2. Is the guarantee vacuous?**

Does the ensures clause already follow trivially from the requires clauses?

- **No**: The lemma establishes or sanity checks something beyond its assumptions.
- **Yes**: The ensures is already inside the requires. The lemma proves nothing. Explain.

**Important:** A lemma that extracts a concrete consequence from an invariant is NOT vacuous. For example, `requires Inv(m); ensures m >= 0` is a useful projection — it tells the reader that non-negativity is one of the things the invariant guarantees. The invariant is opaque from the reader's perspective; the lemma makes a specific property visible. Only flag vacuity when the ensures literally restates a requires clause or follows without unfolding any definitions (e.g. `requires m >= 0; ensures m >= 0`).

**3. Are there surprising restrictions in the requires?**

Invariant dependencies and standard well-formedness conditions are expected and fine. But flag any requires clause that **restricts when the property holds** in a way the NL requirement doesn't mention.

For example: NL says "all counters are non-negative" but the lemma requires `s.mode == Active` — this means the property is only claimed for active states, which the NL doesn't qualify.

Don't flag: `requires Inv(s)` (the invariant is maintained by the system — this is the normal frame).

---

## Output

For each requirement-lemma pair:

```
### Requirement: "<natural language text>"
### Lemma: `<lemma name>`

**Informalization:** [plain English: "This lemma guarantees that ... provided that ..."]

**Ensures matches NL?** [Yes | Partially | No] — [explanation if not Yes]

**Vacuous?** [No | Yes] — [explanation if Yes]

**Surprising restrictions?** [None | list of unexpected requires conditions]

**Verdict:** [JUSTIFIED | PARTIALLY JUSTIFIED | NOT JUSTIFIED | VACUOUS]
```

---

## Guidelines

- Be precise about quantifiers and boundary conditions.
- Invariant dependencies in `requires` are normal — don't flag them.
- Unfold predicates when checking vacuity. Named predicates can hide the ensures clause.
- If the NL requirement is ambiguous, note which interpretation the Dafny chose.
- Your job is adversarial but not paranoid. The code is verified; you're checking the *claim*, not the *proof*.