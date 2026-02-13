/**
 * Build the prompt for formalizing a requirement as a Dafny lemma.
 *
 * The LLM receives the full domain source and the requirement text.
 * No claims extraction, no NL translation, no matching — just source + requirement.
 *
 * @param {string} domain - domain display name
 * @param {string} requirement - the requirement text
 * @param {string} domainSource - full Dafny source code
 */
export function FORMALIZE_PROMPT(domain, requirement, domainSource) {
  return `You are writing a Dafny verification lemma to formally express a user requirement for the "${domain}" domain.

## Domain Source Code

\`\`\`dafny
${domainSource}
\`\`\`

## Requirement to Formalize

"${requirement}"

## Instructions

Write a Dafny lemma that expresses this requirement. The lemma will be placed in a module that imports the domain module as \`D\`, so reference types and functions as \`D.Model\`, \`D.Inv\`, \`D.Init\`, \`D.Apply\`, \`D.Normalize\`, \`D.Action\`, etc.

Guidelines:
- The \`ensures\` clause must express the REQUIREMENT — what the user asked for
- The lemma should have \`requires D.Inv(m)\` if it's about properties of valid states
- Try an empty body \`{}\` first — many properties follow directly from the invariant definition
- If a proof step is needed, call existing domain lemmas (you can see them in the source)
- Keep proof hints minimal (one or two assert statements or lemma calls)
- Do NOT use \`assume\` — the point is to verify, not assume
- Use descriptive parameter names

Call the record_formalization tool with your lemma.`;
}

/**
 * Build the retry prompt when a formalization fails verification.
 */
export function RETRY_PROMPT(domain, requirement, previousCode, dafnyError) {
  return `Your previous Dafny lemma for the "${domain}" domain failed verification.

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

Fix the lemma based on the error. Common issues:
- Wrong type references (use D.Model, D.Inv, etc.)
- Lemma body needs proof hints (add assert statements)
- The property might need to be stated differently
- If the property genuinely does not follow from the invariant, state that in reasoning and write a lemma that demonstrates the closest provable version

Call the record_formalization tool with the corrected lemma.`;
}
