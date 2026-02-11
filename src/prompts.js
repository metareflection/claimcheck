/**
 * Build the prompt for the translate step.
 */
export function TRANSLATE_PROMPT(domain, items) {
  const claimsList = items
    .map((item, idx) => {
      const ctx = item.context;
      const name = ctx.predicateName ?? ctx.lemmaName ?? ctx.functionName ?? 'axiom';
      const reqStr = ctx.requires?.length ? `, given: ${ctx.requires.join(', ')}` : '';
      return `${idx + 1}. [${item.kind}] \`${item.formalText}\`\n   (${name} in ${ctx.module}${reqStr})`;
    })
    .join('\n');

  return `You are translating formal Dafny verification claims from the "${domain}" domain into precise natural language.

For each claim below, produce a natural-language sentence that:
- States EXACTLY what the formal expression means (not more, not less)
- Uses plain English, no Dafny syntax or variable names
- Is self-contained (a reader should understand it without seeing code)
- Preserves logical strength ("for all" stays universal, implications stay conditional)

Claims to translate:
${claimsList}

Call the record_translations tool with one translation per claim, in the same order.`;
}

/**
 * Build the prompt for the compare step.
 */
export function COMPARE_PROMPT(domain, translatedItems, requirementsText) {
  const claimsSection = translatedItems
    .map((item) => `- [${item.id}] "${item.naturalLanguage}" (formal: \`${item.formalText}\`)`)
    .join('\n');

  return `You are analyzing the coverage of formal verification proofs against user requirements for the "${domain}" domain.

## Proved Claims (translated to natural language)
These properties have been FORMALLY PROVED in Dafny:

${claimsSection}

## User Requirements
These are the properties the user EXPECTS to be proved:

${requirementsText}

## Your Task

Compare the proved claims against the user requirements. For each requirement, determine whether there is a formal proof that covers it (fully or partially). For each proved claim, determine whether it corresponds to a stated requirement.

Classify every item into exactly one category:
1. **proved**: A formal claim matches a user requirement. Both are accounted for.
2. **missing**: A user requirement has NO corresponding formal proof.
3. **unexpected**: A formal proof exists but does NOT correspond to any stated requirement.

Be precise about semantic equivalence: "the counter is non-negative" matches "non-negativity (m >= 0)" — same meaning, different words. But "Init returns 0" does NOT match "non-negativity" unless the requirement explicitly mentions initial state.

A single claim can match at most one requirement, and vice versa. If multiple claims together satisfy one requirement, pick the most direct match and list the others as unexpected.

Call the record_coverage tool with your analysis.`;
}

/**
 * Build the prompt for formalizing a requirement as a Dafny lemma.
 */
export function FORMALIZE_PROMPT(domain, requirement, domainSource, claimsIndex) {
  const claimsSummary = claimsIndex
    .map((item) => `- [${item.kind}] ${item.formalText} (${item.context.module})`)
    .join('\n');

  return `You are writing a Dafny verification lemma to formally express a user requirement for the "${domain}" domain.

## Domain Source Code

\`\`\`dafny
${domainSource}
\`\`\`

## Existing Claims (for reference)

${claimsSummary}

## Requirement to Formalize

"${requirement}"

## Instructions

Write a Dafny lemma that expresses this requirement. The lemma will be placed in a module that imports the domain module as \`D\`, so reference types and functions as \`D.Model\`, \`D.Inv\`, \`D.Init\`, \`D.Apply\`, \`D.Normalize\`, \`D.Action\`, etc.

Guidelines:
- The lemma should have \`requires D.Inv(m)\` if it's about properties of valid states
- The \`ensures\` clause should express the requirement precisely
- Try an empty body \`{}\` first — many properties follow directly from definitions
- If a proof hint is needed, keep it minimal (one or two assert statements)
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
