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
