// Stage 1: turn the user's question into a structured lesson plan.
import { z } from 'zod';
import type { AiEngine } from '../ai/engine.js';
import type { LessonPlan } from '../../../shared/types.js';
import { PLAN_SYSTEM, planRetryPrompt, planUserPrompt } from './prompts.js';

const PlanSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(3),
  prerequisites: z.array(z.object({ term: z.string().min(1), explanation: z.string().min(3) })).min(1).max(8),
  analogy: z.object({ text: z.string().min(3) }).nullable(),
  visualGuide: z.string().min(10),
  steps: z
    .array(
      z.object({
        title: z.string().min(1),
        caption: z.string().min(3),
        visual: z.object({
          description: z.string().min(3),
          keyElements: z.array(z.string()).min(1),
          whatChanges: z.string().min(3),
        }),
      }),
    )
    .min(6, 'The lesson needs at least 6 steps')
    .max(12, 'The lesson must have at most 12 steps'),
  recap: z.string().min(3),
});

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in the answer.');
  return JSON.parse(body.slice(start, end + 1));
}

export async function planLesson(engine: AiEngine, input: string, onRetry?: (n: number) => void): Promise<LessonPlan> {
  let prompt = planUserPrompt(input);
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) onRetry?.(attempt);
    const raw = await engine.complete({ system: PLAN_SYSTEM, prompt, label: `plan#${attempt + 1}` });
    try {
      const parsed = PlanSchema.safeParse(extractJson(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    } catch (err) {
      lastError = (err as Error).message;
    }
    prompt = planRetryPrompt(input, raw, lastError);
  }
  throw new Error(`Could not create a valid lesson plan: ${lastError}`);
}
