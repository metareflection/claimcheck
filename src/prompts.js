/**
 * Build the prompt for batch-formalizing ALL requirements as Dafny lemma signatures.
 *
 * The LLM receives erased domain source and all requirements at once.
 * It produces lemma signatures (with empty bodies) for every requirement.
 *
 * @param {string} domain - domain display name
 * @param {string[]} requirements - all requirement texts
 * @param {string} erasedSource - Dafny source with lemma bodies erased
 */
export function BATCH_FORMALIZE_PROMPT(domain, requirements, erasedSource) {
  const reqList = requirements
    .map((r, i) => `${i}. "${r}"`)
    .join('\n');

  return `You are writing Dafny verification lemmas to formally express user requirements for the "${domain}" domain.

## Domain Source Code (signatures only)

\`\`\`dafny
${erasedSource}
\`\`\`

## Requirements

${reqList}

## Instructions

For EACH requirement above, write a Dafny lemma **signature** with an empty body \`{}\`.
The lemma will be placed in a module that imports the domain module as \`D\`, so reference types and functions as \`D.Model\`, \`D.Inv\`, \`D.Init\`, \`D.Apply\`, \`D.Normalize\`, \`D.Action\`, etc.

Guidelines:
- The \`ensures\` clause must express the REQUIREMENT — what the user asked for
- The lemma should have \`requires D.Inv(m)\` if it's about properties of valid states
- Use an empty body \`{}\` — you are only writing signatures, not proofs
- Do NOT use \`assume\`
- Use descriptive parameter names and PascalCase lemma names

Call the record_formalizations tool with one entry per requirement.`;
}

/**
 * Build the prompt for retrying resolution failures on specific lemmas.
 *
 * @param {string} domain - domain display name
 * @param {{ index: number, requirement: string, dafnyCode: string, error: string }[]} failures
 * @param {string} erasedSource - Dafny source with lemma bodies erased
 */
export function RESOLUTION_RETRY_PROMPT(domain, failures, erasedSource) {
  const failureList = failures.map((f) =>
    `### Requirement ${f.index}: "${f.requirement}"

\`\`\`dafny
${f.dafnyCode}
\`\`\`

Error:
\`\`\`
${f.error}
\`\`\``,
  ).join('\n\n');

  return `Your previous Dafny lemma signatures for the "${domain}" domain failed type resolution.

## Domain Source Code (signatures only)

\`\`\`dafny
${erasedSource}
\`\`\`

## Failed Lemmas

${failureList}

## Instructions

Fix the type/resolution errors for each failed lemma. Common issues:
- Wrong type references (use D.Model, D.Inv, D.Init, D.Apply, etc.)
- Wrong field names — check the datatype definitions carefully
- Wrong qualified paths
- Missing D. prefix

Keep the empty body \`{}\` — you are only fixing signatures, not writing proofs.

Call the record_formalizations tool with corrected entries (use the same requirementIndex values).`;
}

/**
 * Build the prompt for writing a proof body for a well-typed signature.
 *
 * @param {string} domain - domain display name
 * @param {string} requirement - the requirement text
 * @param {string} signature - the well-typed lemma signature (empty body)
 * @param {string} verifyError - the Dafny verify error
 * @param {string} domainSource - full Dafny source code (or erased, based on --erase)
 */
export function PROOF_PROMPT(domain, requirement, signature, verifyError, domainSource) {
  return `You are writing a proof body for a Dafny verification lemma in the "${domain}" domain.

## Domain Source Code

\`\`\`dafny
${domainSource}
\`\`\`

## Requirement

"${requirement}"

## Well-Typed Lemma Signature

This signature already typechecks. You need to fill in the proof body.

\`\`\`dafny
${signature}
\`\`\`

## Dafny Verification Error

\`\`\`
${verifyError}
\`\`\`

## Instructions

Write the complete lemma with a proof body that makes it verify. The signature (parameters, requires, ensures) is correct — only add proof steps inside the body.

Guidelines:
- Call existing domain lemmas if they help (you can see them in the source)
- Keep proof hints minimal (assert statements, lemma calls, calc blocks)
- Do NOT change the requires/ensures clauses — only fill in the body
- Do NOT use \`assume\`

Call the record_formalization tool with the complete lemma.`;
}

/**
 * Build the retry prompt for a failed proof attempt.
 *
 * @param {string} domain - domain display name
 * @param {string} requirement - the requirement text
 * @param {string} previousCode - the previous proof attempt
 * @param {string} dafnyError - the Dafny error
 */
export function PROOF_RETRY_PROMPT(domain, requirement, previousCode, dafnyError) {
  return `Your previous Dafny proof for the "${domain}" domain failed verification.

## Requirement

"${requirement}"

## Previous Attempt

\`\`\`dafny
${previousCode}
\`\`\`

## Dafny Error

\`\`\`
${dafnyError}
\`\`\`

## Instructions

Fix the proof body based on the error. Do NOT change the requires/ensures clauses — only fix the proof steps inside the body.

Common issues:
- Missing lemma calls or assert statements
- Wrong proof strategy — try a different approach
- Need to strengthen intermediate assertions

Do NOT use \`assume\`.

Call the record_formalization tool with the corrected lemma.`;
}

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
 * Build the prompt for re-formalizing lemmas that failed the round-trip check.
 *
 * @param {string} domain - domain display name
 * @param {{ requirementIndex: number, requirement: string, dafnyCode: string, discrepancy: string, weakeningType: string }[]} failures
 * @param {string} erasedSource - Dafny source with lemma bodies erased
 */
export function ROUNDTRIP_REFORMALIZE_PROMPT(domain, failures, erasedSource) {
  const failureList = failures.map((f) =>
    `### Requirement ${f.requirementIndex}: "${f.requirement}"

**Previous attempt:**
\`\`\`dafny
${f.dafnyCode}
\`\`\`

**Discrepancy:** ${f.discrepancy}
**Weakening type:** ${f.weakeningType}`).join('\n\n');

  return `Your previous Dafny lemma signatures for the "${domain}" domain failed a round-trip faithfulness check. The lemmas were back-translated to English, and the back-translations did not match the original requirements.

## Domain Source Code (signatures only)

\`\`\`dafny
${erasedSource}
\`\`\`

## Failed Lemmas

${failureList}

## Instructions

Re-formalize each failed requirement. The discrepancy tells you exactly what went wrong — your ensures clause did not faithfully express the requirement.

Common fixes:
- If "tautology": the ensures clause restated the requires clause. Write an ensures that actually says something new.
- If "weakened-postcondition": the ensures was too weak. Strengthen it to match the requirement exactly.
- If "narrowed-scope": the lemma didn't cover all cases. Add parameters or quantifiers to cover the full scope.
- If "missing-case": add the missing conditions to ensures.
- If "wrong-property": you proved the wrong thing. Re-read the requirement carefully.

Keep the empty body \`{}\` — you are only fixing signatures, not writing proofs.

Call the record_formalizations tool with corrected entries (use the same requirementIndex values).`;
}

/**
 * Build the prompt for translating flat formal claims to English (bottom-up pipeline).
 *
 * @param {string} domain - domain display name
 * @param {{ id: string, kind: string, formalText: string, context: string }[]} items - claims to translate
 */
export function TRANSLATE_PROMPT(domain, items) {
  const itemList = items
    .map((item) => `- **${item.id}** (${item.kind}): \`${item.formalText}\`${item.context ? `\n  Context: ${item.context}` : ''}`)
    .join('\n');

  return `You are translating formal Dafny claims from the "${domain}" domain into plain English.

## Claims

${itemList}

## Instructions

For each claim, write a concise English statement of what it means. Be literal — describe what the formal expression says, not what you think the author intended.

Rate your confidence (0-1) for each translation. Lower confidence for complex expressions or domain-specific predicates you're unsure about.

Call the record_translations tool with one entry per claim.`;
}

/**
 * Build the prompt for comparing translated claims against requirements (bottom-up pipeline).
 *
 * @param {string} domain - domain display name
 * @param {{ id: string, naturalLanguage: string, kind: string }[]} translatedItems - translated claims
 * @param {string} requirementsText - raw requirements markdown
 */
export function COMPARE_PROMPT(domain, translatedItems, requirementsText) {
  const claimList = translatedItems
    .map((item) => `- **${item.id}** (${item.kind}): ${item.naturalLanguage}`)
    .join('\n');

  return `You are analyzing coverage of user requirements by formal Dafny claims in the "${domain}" domain.

## User Requirements

${requirementsText}

## Verified Claims (translated to English)

${claimList}

## Instructions

Determine which requirements are covered by the formal claims, which are missing, and which claims don't correspond to any requirement.

A requirement is "covered" if one or more claims together guarantee what the requirement asks for. Be precise about partial coverage — if claims cover part of a requirement but not all, list it as missing with an explanation.

Call the record_coverage tool with your analysis.`;
}
