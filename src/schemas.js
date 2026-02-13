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
