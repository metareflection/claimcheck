/**
 * Translation quality assertion using LLM-as-judge.
 * Uses Claude Opus to grade each translation for:
 *   - Semantic fidelity to the formal Dafny expression
 *   - No Dafny syntax leakage
 *   - Self-containedness (readable without code)
 *   - Completeness (all conditions captured)
 *
 * Samples up to 15 translations per project.
 * Pass threshold: average >= 0.7, no individual score below 0.5.
 */

import Anthropic from '@anthropic-ai/sdk';

const JUDGE_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_SAMPLES = 15;

const JUDGE_TOOL = {
  name: 'record_grade',
  description: 'Record a translation quality grade',
  input_schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            claimId: { type: 'string' },
            fidelity: {
              type: 'number',
              description: 'Semantic fidelity to formal expression (0-1)',
            },
            noLeakage: {
              type: 'number',
              description: 'No Dafny syntax leakage (0-1)',
            },
            selfContained: {
              type: 'number',
              description: 'Readable without seeing code (0-1)',
            },
            completeness: {
              type: 'number',
              description: 'All conditions captured (0-1)',
            },
          },
          required: ['claimId', 'fidelity', 'noLeakage', 'selfContained', 'completeness'],
        },
      },
    },
    required: ['scores'],
  },
};

function buildJudgePrompt(translations) {
  const items = translations.map((t, i) => {
    return `### Translation ${i + 1}
- **Claim ID**: ${t.id}
- **Kind**: ${t.kind}
- **Formal Dafny expression**: \`${t.formalText}\`
- **Natural language translation**: "${t.naturalLanguage}"
- **Confidence**: ${t.confidence}`;
  });

  return `You are grading the quality of natural-language translations of formal Dafny specifications.

For each translation below, score it on four dimensions (0.0 to 1.0):
1. **fidelity** — Does the natural language accurately capture the meaning of the formal expression?
2. **noLeakage** — Is the translation free of Dafny-specific syntax (e.g., no "forall i: int", no "::", no triggers)?
3. **selfContained** — Can a non-programmer understand the translation without seeing the code?
4. **completeness** — Does the translation capture ALL conditions in the formal expression?

${items.join('\n\n')}

Grade each translation using the record_grade tool.`;
}

export default async function translationQuality(output, context) {
  const data = typeof output === 'string' ? JSON.parse(output) : output;
  const translated = data.translated;

  if (!translated || translated.length === 0) {
    return { pass: false, score: 0, reason: 'No translations to grade' };
  }

  // Sample up to MAX_SAMPLES translations
  let samples;
  if (translated.length <= MAX_SAMPLES) {
    samples = translated;
  } else {
    // Evenly distributed sample
    const step = translated.length / MAX_SAMPLES;
    samples = [];
    for (let i = 0; i < MAX_SAMPLES; i++) {
      samples.push(translated[Math.floor(i * step)]);
    }
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      tools: [JUDGE_TOOL],
      tool_choice: { type: 'tool', name: 'record_grade' },
      messages: [{ role: 'user', content: buildJudgePrompt(samples) }],
    });

    const toolUse = response.content.find(b => b.type === 'tool_use');
    if (!toolUse) {
      return { pass: false, score: 0, reason: 'Judge did not return structured grades' };
    }

    const grades = toolUse.input.scores;
    if (!grades || grades.length === 0) {
      return { pass: false, score: 0, reason: 'Judge returned empty grades' };
    }

    // Calculate per-item and overall scores
    const itemScores = grades.map(g => {
      const avg = (g.fidelity + g.noLeakage + g.selfContained + g.completeness) / 4;
      return { claimId: g.claimId, score: avg, ...g };
    });

    const avgScore = itemScores.reduce((sum, s) => sum + s.score, 0) / itemScores.length;
    const minScore = Math.min(...itemScores.map(s => s.score));
    const belowThreshold = itemScores.filter(s => s.score < 0.5);

    const pass = avgScore >= 0.7 && belowThreshold.length === 0;

    const details = [];
    if (avgScore < 0.7) {
      details.push(`Average score ${avgScore.toFixed(2)} < 0.7 threshold`);
    }
    if (belowThreshold.length > 0) {
      details.push(`${belowThreshold.length} translations below 0.5: ${belowThreshold.map(s => s.claimId).join(', ')}`);
    }

    return {
      pass,
      score: avgScore,
      reason: pass
        ? `Translation quality: avg=${avgScore.toFixed(2)}, min=${minScore.toFixed(2)}, ${grades.length} samples graded`
        : `Translation quality issues: ${details.join('; ')}`,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Judge API call failed: ${err.message}`,
    };
  }
}
