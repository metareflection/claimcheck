export const INFORMALIZE_TOOL = {
  name: 'record_informalizations',
  description: 'Record English back-translations of Dafny lemma signatures.',
  input_schema: {
    type: 'object',
    properties: {
      informalizations: {
        type: 'array',
        description: 'One informalization per lemma.',
        items: {
          type: 'object',
          properties: {
            lemmaName: {
              type: 'string',
              description: 'Name of the lemma being informalized.',
            },
            naturalLanguage: {
              type: 'string',
              description: 'Plain English statement of what the lemma guarantees. Be literal about what the code says.',
            },
            preconditions: {
              type: 'string',
              description: 'What must be true before (the requires clauses), in English.',
            },
            postcondition: {
              type: 'string',
              description: 'What is guaranteed after (the ensures clauses), in English.',
            },
            scope: {
              type: 'string',
              description: 'What the lemma applies to: a single state, a transition, all reachable states, etc.',
            },
            strength: {
              type: 'string',
              enum: ['trivial', 'weak', 'moderate', 'strong'],
              description: 'How strong is this claim? "trivial" if ensures restates requires or is a tautology, "weak" if it says very little, "moderate" if substantive, "strong" if it constrains behavior significantly.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence (0-1) that the back-translation is faithful to the Dafny code.',
            },
          },
          required: ['lemmaName', 'naturalLanguage', 'preconditions', 'postcondition', 'scope', 'strength', 'confidence'],
        },
      },
    },
    required: ['informalizations'],
  },
};

export const ROUNDTRIP_COMPARE_TOOL = {
  name: 'record_roundtrip_comparisons',
  description: 'Record comparison results between original requirements and back-translated lemmas.',
  input_schema: {
    type: 'object',
    properties: {
      comparisons: {
        type: 'array',
        description: 'One comparison per requirement-lemma pair.',
        items: {
          type: 'object',
          properties: {
            requirementIndex: {
              type: 'integer',
              description: 'Zero-based index of the original requirement.',
            },
            lemmaName: {
              type: 'string',
              description: 'Name of the lemma being compared.',
            },
            match: {
              type: 'boolean',
              description: 'True if the lemma faithfully expresses the requirement. False if there is any meaningful discrepancy.',
            },
            discrepancy: {
              type: 'string',
              description: 'If match is false, describe exactly what the lemma gets wrong or misses.',
            },
            weakeningType: {
              type: 'string',
              enum: ['none', 'tautology', 'weakened-postcondition', 'narrowed-scope', 'missing-case', 'wrong-property'],
              description: 'Category of weakening detected, or "none" if match is true.',
            },
            explanation: {
              type: 'string',
              description: 'Brief explanation of the comparison reasoning.',
            },
          },
          required: ['requirementIndex', 'lemmaName', 'match', 'discrepancy', 'weakeningType', 'explanation'],
        },
      },
    },
    required: ['comparisons'],
  },
};
