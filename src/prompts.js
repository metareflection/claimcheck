/**
 * Build the prompt for informalizing Dafny lemmas back to English.
 *
 * CRITICAL: This prompt must NOT include the original requirements.
 * The LLM reads only the Dafny code and produces English descriptions.
 * This is the first half of the round-trip check.
 *
 * @param {string} domain - domain display name
 * @param {{ lemmaName: string, dafnyCode: string }[]} lemmas - resolved lemma signatures
 */
export function INFORMALIZE_PROMPT(domain, lemmas) {
  const lemmaList = lemmas
    .map((l, i) => `### Lemma ${i}: ${l.lemmaName}\n\n\`\`\`dafny\n${l.dafnyCode}\n\`\`\``)
    .join('\n\n');

  return `You are reading Dafny verification lemmas from the "${domain}" domain and translating them to plain English.

## Lemmas

${lemmaList}

## Instructions

For each lemma, produce a faithful English description of what the Dafny code actually says. Be LITERAL — describe what the code guarantees, not what you think the author intended.

Specifically:
- State the preconditions (requires) and postconditions (ensures) separately
- Describe the scope: does it apply to a single state, a transition, all reachable states, etc.?
- Rate the strength of the claim:
  - "trivial" if the ensures clause restates the requires clause, is a tautology (always true), or follows trivially from definitions
  - "weak" if it says very little (e.g. ensures a value exists but not what it equals)
  - "moderate" if it makes a substantive claim about behavior
  - "strong" if it significantly constrains the system's behavior
- Flag anything suspicious: ensures that mirror requires, postconditions that are always true regardless of preconditions, claims about wrong properties

Do NOT guess at the original intent. Only describe what the Dafny code literally says.

Call the record_informalizations tool with one entry per lemma.`;
}

/**
 * Build the prompt for comparing original requirements against back-translated lemmas.
 *
 * @param {string} domain - domain display name
 * @param {{ requirementIndex: number, requirement: string, lemmaName: string, dafnyCode: string, informalization: object }[]} pairs
 */
export function ROUNDTRIP_COMPARE_PROMPT(domain, pairs) {
  const pairList = pairs.map((p) =>
    `### Requirement ${p.requirementIndex}: "${p.requirement}"

**Lemma:** ${p.lemmaName}

\`\`\`dafny
${p.dafnyCode}
\`\`\`

**Back-translation:**
- English: ${p.informalization.naturalLanguage}
- Preconditions: ${p.informalization.preconditions}
- Postcondition: ${p.informalization.postcondition}
- Scope: ${p.informalization.scope}
- Strength: ${p.informalization.strength}`).join('\n\n');

  return `You are checking whether Dafny lemmas faithfully express their intended requirements for the "${domain}" domain.

For each pair below, compare the ORIGINAL requirement against the BACK-TRANSLATION of the Dafny lemma. The back-translation was produced by a different model that did NOT see the original requirements.

## Pairs to Compare

${pairList}

## Cheating Patterns to Watch For

1. **Tautology**: ensures clause restates the requires clause (e.g. requires x > 0; ensures x > 0)
2. **Weakened postcondition**: ensures says less than the requirement asks (e.g. requirement says "exactly 5 colors" but ensures says "at least 1 color")
3. **Narrowed scope**: lemma only covers a subset of cases the requirement describes
4. **Missing case**: requirement has multiple conditions but lemma only captures some
5. **Wrong property**: lemma proves something related but different from what was asked

## Instructions

Be STRICT. It is better to flag a potential mismatch than to miss real cheating. A lemma that technically proves something true but doesn't capture the requirement's intent should be flagged.

However, do not flag lemmas just because the English phrasing differs — focus on whether the MEANING is preserved.

If the back-translation's strength is "trivial", that is almost always a mismatch unless the requirement itself is trivial.

Call the record_roundtrip_comparisons tool with one entry per pair.`;
}

/**
 * Build a single-prompt claimcheck for one requirement-lemma pair.
 *
 * The prompt asks the model to:
 * 1. Informalize the lemma (without reading the NL requirement first)
 * 2. Compare against the NL requirement
 * 3. Check for vacuity and surprising restrictions
 *
 * Based on claimcheck-prompt.md.
 *
 * @param {string} domain - domain display name
 * @param {string} lemmaName
 * @param {string} dafnyCode - extracted lemma source
 * @param {string} requirement - natural language requirement
 */
export function CLAIMCHECK_PROMPT(domain, lemmaName, dafnyCode, requirement) {
  return `You are reviewing whether a verified Dafny lemma justifies a natural language requirement it claims to formalize, in the "${domain}" domain.

**Key assumption:** The Dafny code is correct and verified. You are NOT auditing the proof. You are checking whether the lemma contract (requires/ensures) actually says what the natural language claims it says.

## Dafny Code

\`\`\`dafny
${dafnyCode}
\`\`\`

## Analysis (Two Passes)

### Pass 1 — Informalize the Lemma

State in plain English:
- **What it guarantees** (ensures clauses, in your own words)
- **Under what conditions** (requires clauses, in your own words — unfold predicates enough to be clear, but invariant dependencies are fine and expected)

Do this BEFORE reading the natural language requirement below.

### Pass 2 — Compare

Now read the NL requirement:

> ${requirement}

Answer three questions:

**1. Does the ensures clause express the NL claim?**
- **Yes**: The guarantee matches the requirement (it may be stronger, that's fine).
- **Partially**: The guarantee covers some but not all of the NL claim. State what's missing.
- **No**: The guarantee says something different from the NL claim.

Pay attention to: quantifier scope, boundary conditions (\`<\` vs \`<=\`), and whether the Dafny formalizes a slightly different concept than the NL intends.

**2. Is the guarantee vacuous?**
Does the ensures clause already follow trivially from the requires clauses?
- **No**: The lemma establishes something beyond its assumptions.
- **Yes**: The ensures is already inside the requires. The lemma proves nothing. Explain.

**Important:** A lemma that extracts a concrete consequence from an invariant is NOT vacuous. For example, \`requires Inv(m); ensures m >= 0\` is a useful projection — it makes a specific property of the invariant visible. Only flag vacuity when the ensures literally restates a requires clause without unfolding any definitions (e.g. \`requires m >= 0; ensures m >= 0\`).

**3. Are there surprising restrictions in the requires?**
Invariant dependencies and standard well-formedness conditions are expected and fine. But flag any requires clause that **restricts when the property holds** in a way the NL requirement doesn't mention.

## Guidelines
- Be precise about quantifiers and boundary conditions.
- Invariant dependencies in requires are normal — don't flag them.
- Unfold predicates when checking vacuity.
- If the NL requirement is ambiguous, note which interpretation the Dafny chose.
- Your job is adversarial but not paranoid.

Call the record_claimcheck tool with your analysis for lemma \`${lemmaName}\`.`;
}

/**
 * Naive single-prompt: just present both artifacts and ask "does this match?"
 * No two-pass structure, no informalization step.
 * Serves as an ablation baseline for the structured CLAIMCHECK_PROMPT.
 *
 * @param {string} domain
 * @param {string} lemmaName
 * @param {string} dafnyCode
 * @param {string} requirement
 */
export function NAIVE_PROMPT(domain, lemmaName, dafnyCode, requirement) {
  return `You are checking whether a verified Dafny lemma correctly formalizes a natural language requirement, in the "${domain}" domain.

## Natural Language Requirement

> ${requirement}

## Dafny Lemma

\`\`\`dafny
${dafnyCode}
\`\`\`

## Instructions

Does this Dafny lemma faithfully capture the natural language requirement above?

- **JUSTIFIED** if the lemma's contract (requires/ensures) expresses the requirement (it may be stronger, that's fine).
- **NOT_JUSTIFIED** if there is a meaningful discrepancy: the lemma is weaker, proves something different, is vacuous, or misses key aspects.

Invariant dependencies in requires clauses (e.g. \`requires Inv(state)\`) are expected and normal — don't count them as discrepancies. A lemma that extracts a concrete consequence from an invariant is useful, not vacuous.

Call the record_naive_verdict tool with your verdict for lemma \`${lemmaName}\`.`;
}
