// Stage 2: generate the animation code for one step, check it, and retry with feedback.
import type { AiEngine } from '../ai/engine.js';
import type { LessonPlan, StepVisual } from '../../../shared/types.js';
import { validateStep, type ValidationResult } from '../validate/validator.js';
import { STEP_SYSTEM, stepRetryPrompt, stepUserPrompt } from './prompts.js';

export const MAX_RETRIES = 2;

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bsetTimeout\b|\bsetInterval\b|requestAnimationFrame/, 'Do not use timers (setTimeout/setInterval/requestAnimationFrame); use timeline tweens only.'],
  [/\.call\s*\(/, 'Do not use tl.call(); callbacks break seeking. Use tweens only.'],
  [/Math\.random|Date\.now|new Date/, 'Do not use Math.random or dates; the animation must be deterministic.'],
  [/\bfetch\s*\(|XMLHttpRequest|import\s*\(/, 'No network access is allowed.'],
  [/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, 'Do not use literal colours; use colour roles (neutral, active, new, old, danger, accent, muted).'],
  [/\bdocument\.|\bwindow\.|innerHTML/, 'Do not access the DOM or window directly; use the h.* helpers.'],
];

export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```(?:js|javascript|ts)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  let code = (blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : text).trim();
  const wrapped = code.match(/^function\s+render\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?$/);
  if (wrapped) code = wrapped[1].trim();
  return code;
}

/** Removes string literals and comments so labels like 'document.body' don't trigger the checks. */
function stripStrings(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '""')
    .replace(/\/\/.*$/gm, '');
}

function staticProblems(code: string): string[] {
  const bare = stripStrings(code);
  return FORBIDDEN.filter(([re]) => re.test(bare)).map(([, msg]) => msg);
}

export interface BuildStepOptions {
  engine: AiEngine;
  plan: LessonPlan;
  index: number;
  referenceCode?: string;
  referenceIndex?: number;
  feedback?: string;
  onStatus?: (message: string) => void;
}

interface Attempt {
  code: string;
  result: ValidationResult;
  problems: string[];
}

export async function buildStep(opts: BuildStepOptions): Promise<StepVisual> {
  const { engine, plan, index, onStatus } = opts;
  const n = index + 1;
  const total = plan.steps.length;
  const base = stepUserPrompt(opts);
  let prompt = base;
  let best: Attempt | null = null;
  let lastError = '';
  let attempts = 0;

  for (let i = 0; i <= MAX_RETRIES; i++) {
    attempts++;
    onStatus?.(i === 0 ? `Building step ${n} of ${total}…` : `Fixing step ${n} of ${total} (retry ${i} of ${MAX_RETRIES})…`);
    let code: string;
    try {
      code = extractCode(await engine.complete({ system: STEP_SYSTEM, prompt, label: `step ${n} #${i + 1}` }));
    } catch (err) {
      lastError = (err as Error).message;
      continue;
    }
    onStatus?.(`Checking step ${n} of ${total}…`);
    let result: ValidationResult;
    try {
      result = await validateStep(code);
    } catch {
      // Browser crashed (often low memory): try once more with a fresh browser.
      try {
        result = await validateStep(code);
      } catch (err) {
        lastError = `Could not check the animation: ${(err as Error).message}`;
        break;
      }
    }
    const problems = result.ok ? [...staticProblems(code), ...result.issues] : [`Runtime error: ${result.error}`];
    console.log(`[step ${n}] attempt ${i + 1}: ${result.ok ? `${result.issues.length} layout issue(s)` : `error: ${result.error}`}`);

    if (result.ok && (!best || problems.length < best.problems.length)) best = { code, result, problems };
    if (result.ok && problems.length === 0) break;
    if (!result.ok) lastError = result.error ?? 'Unknown error';
    prompt = stepRetryPrompt(base, code, problems);
  }

  const now = new Date().toISOString();
  if (!best) {
    return { status: 'error', error: `Step ${n} failed after ${attempts} attempts: ${lastError}`, attempts, updatedAt: now };
  }
  // Code runs fine; keep the cleanest attempt even if minor layout issues remain.
  return {
    status: 'ready',
    code: best.code,
    attempts,
    warnings: [...best.problems, ...best.result.warnings],
    updatedAt: now,
  };
}
