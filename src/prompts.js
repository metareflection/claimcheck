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
