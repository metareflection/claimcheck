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
