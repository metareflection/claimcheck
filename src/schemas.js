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
      nlAmbiguous: {
        type: 'boolean',
        description: 'True ONLY if the requirement admits more than one reasonable reading AND the verdict depends on which reading is taken. If the lemma is at least as strong as the requirement under every reasonable reading, set false (and match true). If it fails under every reading, set false (and match false).',
      },
      readings: {
        type: 'array',
        description: 'Every reasonable reading of the requirement, each written as a Dafny contract over the lemma\'s own parameters. An unambiguous requirement has exactly ONE reading. Never empty.',
        items: {
          type: 'object',
          properties: {
            reading: { type: 'string', description: 'One reasonable reading of the requirement, stated precisely in English.' },
            requires: { type: 'string', description: 'This reading as a Dafny precondition: ONE boolean expression over exactly the lemma\'s parameters (conjoin with &&). Include the invariant / well-formedness assumptions the lemma relies on (e.g. Inv(m)); those are not part of the ambiguity. Use "true" if none.' },
            ensures: { type: 'string', description: 'This reading as a Dafny postcondition: ONE boolean expression over exactly the lemma\'s parameters.' },
            covered: { type: 'boolean', description: 'Your judgement: is the lemma at least as strong as this reading? (Its requires is implied by this requires, and its ensures implies this ensures.)' },
          },
          required: ['reading', 'requires', 'ensures', 'covered'],
        },
      },
      interpretation: {
        type: 'string',
        description: 'The reading the lemma actually formalizes (copy of the matching reading text). Empty string if nlAmbiguous is false.',
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
        description: 'Overall verdict. When nlAmbiguous is true, give the verdict for the most natural reading; the readings array carries the per-reading result.',
      },
    },
    required: ['lemmaName', 'requirement', 'informalization', 'ensuresMatchesNL', 'ensuresExplanation', 'nlAmbiguous', 'readings', 'interpretation', 'vacuous', 'vacuousExplanation', 'surprisingRestrictions', 'verdict'],
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
              description: 'True if the lemma faithfully expresses the requirement under every reasonable reading (being stronger is fine). False if there is a meaningful discrepancy. When nlAmbiguous is true, set match according to the most natural reading.',
            },
            nlAmbiguous: {
              type: 'boolean',
              description: 'True ONLY if the requirement admits more than one reasonable reading AND the verdict depends on which reading is taken. If the lemma is at least as strong as the requirement under every reasonable reading, set false (and match true). If it fails under every reading, set false (and match false).',
            },
            readings: {
              type: 'array',
              description: 'Every reasonable reading of the requirement, each written as a Dafny contract over the lemma\'s own parameters. An unambiguous requirement has exactly ONE reading. Never empty.',
              items: {
                type: 'object',
                properties: {
                  reading: { type: 'string', description: 'One reasonable reading of the requirement, stated precisely in English.' },
                  requires: { type: 'string', description: 'This reading as a Dafny precondition: ONE boolean expression over exactly the lemma\'s parameters (conjoin with &&). Include the invariant / well-formedness assumptions the lemma relies on (e.g. Inv(m)); those are not part of the ambiguity. Use "true" if none.' },
                  ensures: { type: 'string', description: 'This reading as a Dafny postcondition: ONE boolean expression over exactly the lemma\'s parameters.' },
                  covered: { type: 'boolean', description: 'Your judgement: is the lemma at least as strong as this reading? (Its requires is implied by this requires, and its ensures implies this ensures.)' },
                },
                required: ['reading', 'requires', 'ensures', 'covered'],
              },
            },
            interpretation: {
              type: 'string',
              description: 'The reading the lemma actually formalizes (copy of the matching reading text). Empty string if nlAmbiguous is false.',
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
          required: ['requirementIndex', 'lemmaName', 'match', 'discrepancy', 'weakeningType', 'explanation', 'nlAmbiguous', 'readings', 'interpretation'],
        },
      },
    },
    required: ['comparisons'],
  },
};
