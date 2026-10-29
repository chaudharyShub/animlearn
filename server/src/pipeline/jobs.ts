// Runs lesson generation in the background and broadcasts progress to listeners (SSE).
import { EventEmitter } from 'node:events';
import { nanoid } from 'nanoid';
import type { AiEngine } from '../ai/engine.js';
import type { GenerationEvent, Lesson, StepVisual } from '../../../shared/types.js';
import { lessonStore } from '../storage/lessonStore.js';
import { planLesson } from './planLesson.js';
import { buildStep } from './buildStep.js';

const CONCURRENCY = Math.max(1, Number(process.env.ANIMLEARN_CONCURRENCY) || 3);

interface Job {
  lesson: Lesson;
  emitter: EventEmitter;
  lastProgress: string;
  running: boolean;
}

const jobs = new Map<string, Job>();

/** Simple promise pool: runs tasks with at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift() as T);
  });
  await Promise.all(workers);
}

function getJob(lesson: Lesson): Job {
  let job = jobs.get(lesson.id);
  if (!job) {
    job = { lesson, emitter: new EventEmitter(), lastProgress: '', running: false };
    job.emitter.setMaxListeners(50);
    jobs.set(lesson.id, job);
  }
  job.lesson = lesson;
  return job;
}

function emit(job: Job, event: GenerationEvent) {
  if (event.type === 'progress') job.lastProgress = event.message;
  job.emitter.emit('event', event);
}

async function persist(job: Job) {
  await lessonStore.save(job.lesson);
  emit(job, { type: 'lesson', lesson: job.lesson });
}

function finalStatus(lesson: Lesson): Lesson['status'] {
  return lesson.steps.every((s) => s.status === 'ready') ? 'ready' : 'partial';
}

function nearestReadyStep(lesson: Lesson, index: number): number | undefined {
  let best: number | undefined;
  lesson.steps.forEach((s, i) => {
    if (i !== index && s.status === 'ready' && s.code && (best === undefined || Math.abs(i - index) < Math.abs(best - index))) best = i;
  });
  return best;
}

export function subscribe(id: string, listener: (e: GenerationEvent) => void): (() => void) | null {
  const job = jobs.get(id);
  if (!job || !job.running) return null;
  job.emitter.on('event', listener);
  listener({ type: 'lesson', lesson: job.lesson });
  if (job.lastProgress) listener({ type: 'progress', message: job.lastProgress });
  return () => job.emitter.off('event', listener);
}

export function isRunning(id: string): boolean {
  return !!jobs.get(id)?.running;
}

export async function startLesson(engine: AiEngine, prompt: string): Promise<Lesson> {
  const now = new Date().toISOString();
  const lesson: Lesson = { id: nanoid(12), prompt, createdAt: now, updatedAt: now, status: 'planning', steps: [] };
  await lessonStore.save(lesson);
  const job = getJob(lesson);
  job.running = true;
  void runLesson(engine, job);
  return lesson;
}

async function runLesson(engine: AiEngine, job: Job) {
  const lesson = job.lesson;
  try {
    emit(job, { type: 'progress', message: 'Planning lesson…' });
    lesson.plan = await planLesson(engine, lesson.prompt, (n) => emit(job, { type: 'progress', message: `Planning lesson (retry ${n})…` }));
    lesson.status = 'building';
    lesson.steps = lesson.plan.steps.map((): StepVisual => ({ status: 'pending', attempts: 0 }));
    await persist(job);

    const total = lesson.steps.length;
    let done = 0;
    const build = async (i: number) => {
      lesson.steps[i] = { ...lesson.steps[i], status: 'building' };
      await persist(job);
      const ref = nearestReadyStep(lesson, i);
      // One failing step must not stop the rest of the lesson.
      const result = await buildStep({
        engine,
        plan: lesson.plan!,
        index: i,
        referenceIndex: ref,
        referenceCode: ref !== undefined ? lesson.steps[ref].code : undefined,
        onStatus: (message) => emit(job, { type: 'progress', message: done ? `${message} (${done} of ${total} done)` : message }),
      }).catch((err): StepVisual => ({ status: 'error', error: (err as Error).message, attempts: 0, updatedAt: new Date().toISOString() }));
      lesson.steps[i] = result;
      done++;
      await persist(job);
    };

    // Step 1 first, so the others can follow its layout and style. Then the rest in parallel.
    await build(0);
    await pool(
      lesson.steps.map((_, i) => i).slice(1),
      CONCURRENCY,
      build,
    );

    lesson.status = finalStatus(lesson);
    await lessonStore.save(lesson);
    emit(job, { type: 'done', lesson });
  } catch (err) {
    lesson.status = 'error';
    lesson.error = (err as Error).message;
    console.error('[lesson] failed:', lesson.error);
    await lessonStore.save(lesson);
    emit(job, { type: 'failed', message: lesson.error });
  } finally {
    job.running = false;
  }
}

export async function regenerateStep(engine: AiEngine, lesson: Lesson, index: number, feedback?: string): Promise<void> {
  if (isRunning(lesson.id)) throw new Error('This lesson is still generating.');
  if (!lesson.plan || index < 0 || index >= lesson.plan.steps.length) throw new Error('Invalid step');
  const job = getJob(lesson);
  job.running = true;
  job.lastProgress = '';
  const previous = lesson.steps[index];
  lesson.status = 'building';
  lesson.steps[index] = { ...lesson.steps[index], status: 'building', error: undefined };
  await persist(job);
  void (async () => {
    try {
      const ref = nearestReadyStep(lesson, index);
      const result = await buildStep({
        engine,
        plan: lesson.plan!,
        index,
        referenceIndex: ref,
        referenceCode: ref !== undefined ? lesson.steps[ref].code : undefined,
        feedback: feedback?.trim() || undefined,
        onStatus: (message) => emit(job, { type: 'progress', message }),
      });
      if (result.status === 'error' && previous.status === 'ready') {
        throw new Error(result.error ?? 'Regeneration failed');
      }
      lesson.steps[index] = result;
      lesson.status = finalStatus(lesson);
      await lessonStore.save(lesson);
      emit(job, { type: 'done', lesson });
    } catch (err) {
      // Never lose a working animation: keep the previous version if regeneration fails.
      const message = (err as Error).message;
      lesson.steps[index] = previous.status === 'ready' ? previous : { status: 'error', error: message, attempts: 0 };
      lesson.status = finalStatus(lesson);
      await lessonStore.save(lesson);
      console.error(`[regenerate] step ${index + 1} failed:`, message);
      emit(job, {
        type: 'failed',
        message: previous.status === 'ready' ? `Regenerating step ${index + 1} failed, so the previous version was kept. (${message})` : message,
      });
    } finally {
      job.running = false;
    }
  })();
}

/** Lessons left half-done by a server restart are marked so they can be fixed step by step. */
export async function recoverInterrupted(): Promise<void> {
  for (const s of await lessonStore.list()) {
    if (s.status !== 'planning' && s.status !== 'building') continue;
    const lesson = await lessonStore.get(s.id);
    if (!lesson) continue;
    if (!lesson.plan) {
      lesson.status = 'error';
      lesson.error = 'Generation was interrupted (server stopped). Please try again.';
    } else {
      lesson.steps = lesson.steps.map((st) =>
        st.status === 'ready' ? st : { ...st, status: 'error', error: 'Generation was interrupted. Regenerate this step.' },
      );
      lesson.status = finalStatus(lesson);
    }
    await lessonStore.save(lesson);
  }
}
