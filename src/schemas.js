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

export const CLAIMCHECK_TOOL = {
  name: 'record_claimcheck',
  description: 'Record the result of checking whether a Dafny lemma contract justifies a natural language claim.',
  input_schema: {
    type: 'object',
    properties: {
      lemmaName: {
        type: 'string',
        description: 'Name of the lemma being checked.',
      },
      requirement: {
        type: 'string',
        description: 'The natural language requirement being checked.',
      },
      informalization: {
        type: 'string',
        description: 'Plain English: "This lemma guarantees that ... provided that ..."',
      },
      ensuresMatchesNL: {
        type: 'string',
        enum: ['Yes', 'Partially', 'No'],
        description: 'Does the ensures clause express the NL claim?',
      },
      ensuresExplanation: {
        type: 'string',
        description: 'Explanation of ensures vs NL comparison. Required if not Yes.',
      },
      vacuous: {
        type: 'boolean',
        description: 'True if the ensures literally restates a requires clause without unfolding any definitions. Extracting a consequence from an invariant (e.g. requires Inv(m); ensures m >= 0) is NOT vacuous.',
      },
      vacuousExplanation: {
        type: 'string',
        description: 'Explanation if vacuous is true.',
      },
      surprisingRestrictions: {
        type: 'string',
        description: 'Any requires clauses that restrict when the property holds in a way the NL does not mention. "None" if none.',
      },
      verdict: {
        type: 'string',
        enum: ['JUSTIFIED', 'PARTIALLY_JUSTIFIED', 'NOT_JUSTIFIED', 'VACUOUS'],
        description: 'Overall verdict.',
      },
    },
    required: ['lemmaName', 'requirement', 'informalization', 'ensuresMatchesNL', 'ensuresExplanation', 'vacuous', 'vacuousExplanation', 'surprisingRestrictions', 'verdict'],
  },
};

export const NAIVE_TOOL = {
  name: 'record_naive_verdict',
  description: 'Record whether a Dafny lemma faithfully captures a natural language requirement.',
  input_schema: {
    type: 'object',
    properties: {
      lemmaName: {
        type: 'string',
        description: 'Name of the lemma being checked.',
      },
      verdict: {
        type: 'string',
        enum: ['JUSTIFIED', 'NOT_JUSTIFIED'],
        description: 'JUSTIFIED if the lemma captures the requirement, NOT_JUSTIFIED if there is a meaningful discrepancy.',
      },
      explanation: {
        type: 'string',
        description: 'Brief explanation of your verdict.',
      },
    },
    required: ['lemmaName', 'verdict', 'explanation'],
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
