export const TRANSLATE_TOOL = {
  name: 'record_translations',
  description: 'Record the natural-language translations of each formal Dafny claim.',
  input_schema: {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        description: 'One translation per input claim, in the same order.',
        items: {
          type: 'object',
          properties: {
            naturalLanguage: {
              type: 'string',
              description: 'A precise natural-language statement of what this formal expression means. Must be a complete sentence. Must not use Dafny syntax.',
            },
            confidence: {
              type: 'number',
              description: 'Confidence in translation accuracy, 0.0 to 1.0.',
            },
          },
          required: ['naturalLanguage', 'confidence'],
        },
      },
    },
    required: ['translations'],
  },
};

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

export const MATCH_TOOL = {
  name: 'record_matches',
  description: 'Record candidate claim-requirement matches for formal verification.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        description: 'One entry per requirement, with candidate claims ranked by confidence.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'The requirement text.' },
            candidates: {
              type: 'array',
              description: 'Candidate claims that might cover this requirement, ranked by confidence.',
              items: {
                type: 'object',
                properties: {
                  claimId: { type: 'string', description: 'The claim ID from the input.' },
                  confidence: { type: 'number', description: 'Match confidence, 0.0 to 1.0.' },
                  explanation: { type: 'string', description: 'Why this claim might cover the requirement.' },
                },
                required: ['claimId', 'confidence', 'explanation'],
              },
            },
          },
          required: ['requirement', 'candidates'],
        },
      },
      unexpected: {
        type: 'array',
        description: 'Proved claims that do NOT match any user requirement.',
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string', description: 'The claim ID.' },
            naturalLanguage: { type: 'string', description: 'The translated claim.' },
            explanation: { type: 'string', description: 'Why this does not match any requirement.' },
          },
          required: ['claimId', 'naturalLanguage', 'explanation'],
        },
      },
      summary: {
        type: 'string',
        description: 'A 2-3 sentence overall assessment of how well claims align with requirements.',
      },
    },
    required: ['matches', 'unexpected', 'summary'],
  },
};

export const COMPARE_TOOL = {
  name: 'record_coverage',
  description: 'Record the coverage analysis comparing proved claims against user requirements.',
  input_schema: {
    type: 'object',
    properties: {
      proved: {
        type: 'array',
        description: 'Claims that are formally proved AND match a user requirement.',
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string', description: 'The claim ID from the input.' },
            naturalLanguage: { type: 'string', description: 'The translated claim.' },
            matchedRequirement: { type: 'string', description: 'The requirement text this claim satisfies.' },
            explanation: { type: 'string', description: 'Why this claim satisfies the requirement.' },
          },
          required: ['claimId', 'naturalLanguage', 'matchedRequirement', 'explanation'],
        },
      },
      missing: {
        type: 'array',
        description: 'User requirements that have NO corresponding formal proof.',
        items: {
          type: 'object',
          properties: {
            requirement: { type: 'string', description: 'The requirement text.' },
            explanation: { type: 'string', description: 'Why no existing claim covers this.' },
          },
          required: ['requirement', 'explanation'],
        },
      },
      unexpected: {
        type: 'array',
        description: 'Proved claims that do NOT match any user requirement.',
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string', description: 'The claim ID.' },
            naturalLanguage: { type: 'string', description: 'The translated claim.' },
            explanation: { type: 'string', description: 'Why this does not match any requirement.' },
          },
          required: ['claimId', 'naturalLanguage', 'explanation'],
        },
      },
      summary: {
        type: 'string',
        description: 'A 2-3 sentence overall assessment of coverage quality.',
      },
    },
    required: ['proved', 'missing', 'unexpected', 'summary'],
  },
};
