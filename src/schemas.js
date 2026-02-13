export const FORMALIZE_TOOL = {
  name: 'record_formalization',
  description: 'Record the Dafny lemma that formalizes a user requirement.',
  input_schema: {
    type: 'object',
    properties: {
      lemmaName: {
        type: 'string',
        description: 'A descriptive PascalCase name for the lemma.',
      },
      dafnyCode: {
        type: 'string',
        description: 'Complete Dafny lemma code including requires, ensures, and body. Use an empty body {} if the property follows directly from definitions.',
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of why this lemma expresses the requirement and why it should verify.',
      },
    },
    required: ['lemmaName', 'dafnyCode', 'reasoning'],
  },
};

export const BATCH_FORMALIZE_TOOL = {
  name: 'record_formalizations',
  description: 'Record Dafny lemma signatures for all requirements at once.',
  input_schema: {
    type: 'object',
    properties: {
      lemmas: {
        type: 'array',
        description: 'One lemma signature per requirement.',
        items: {
          type: 'object',
          properties: {
            requirementIndex: {
              type: 'integer',
              description: 'Zero-based index into the requirements array.',
            },
            lemmaName: {
              type: 'string',
              description: 'A descriptive PascalCase name for the lemma.',
            },
            dafnyCode: {
              type: 'string',
              description: 'Dafny lemma signature with requires/ensures clauses and an empty body {}.',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of why this lemma expresses the requirement.',
            },
          },
          required: ['requirementIndex', 'lemmaName', 'dafnyCode', 'reasoning'],
        },
      },
    },
    required: ['lemmas'],
  },
};

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

export const TRANSLATE_TOOL = {
  name: 'record_translations',
  description: 'Record English translations of formal Dafny claims.',
  input_schema: {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        description: 'One translation per claim.',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Structured ID of the claim being translated.',
            },
            naturalLanguage: {
              type: 'string',
              description: 'Plain English statement of what this claim says.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence (0-1) that the translation is faithful.',
            },
          },
          required: ['id', 'naturalLanguage', 'confidence'],
        },
      },
    },
    required: ['translations'],
  },
};

export const COMPARE_TOOL = {
  name: 'record_coverage',
  description: 'Record coverage analysis: which requirements are proved, missing, or unexpected.',
  input_schema: {
    type: 'object',
    properties: {
      proved: {
        type: 'array',
        description: 'Requirements that are covered by formal claims.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'The requirement text.' },
            coveredBy: {
              type: 'array',
              items: { type: 'string' },
              description: 'IDs of claims that cover this requirement.',
            },
            explanation: { type: 'string', description: 'How the claims cover the requirement.' },
          },
          required: ['requirement', 'coveredBy', 'explanation'],
        },
      },
      missing: {
        type: 'array',
        description: 'Requirements not covered by any formal claim.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'The requirement text.' },
            explanation: { type: 'string', description: 'Why no claim covers this requirement.' },
          },
          required: ['requirement', 'explanation'],
        },
      },
      unexpected: {
        type: 'array',
        description: 'Formal claims that do not correspond to any requirement.',
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string', description: 'ID of the unexpected claim.' },
            naturalLanguage: { type: 'string', description: 'What the claim says.' },
            explanation: { type: 'string', description: 'Why this does not match any requirement.' },
          },
          required: ['claimId', 'naturalLanguage', 'explanation'],
        },
      },
      summary: {
        type: 'string',
        description: 'Brief overall assessment of coverage.',
      },
    },
    required: ['proved', 'missing', 'unexpected', 'summary'],
  },
};
