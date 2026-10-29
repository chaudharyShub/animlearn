// Lessons are stored as one JSON file each in data/lessons/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Lesson, LessonSummary } from '../../../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.ANIMLEARN_DATA_DIR || path.resolve(here, '../../../data/lessons');

const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const file = (id: string) => {
  if (!ID_RE.test(id)) throw new Error('Invalid lesson id');
  return path.join(DIR, `${id}.json`);
};

// Writes to the same lesson are queued so parallel step updates never clobber each other.
const writeQueues = new Map<string, Promise<void>>();

export const lessonStore = {
  dir: DIR,

  async init(): Promise<void> {
    await fs.mkdir(DIR, { recursive: true });
  },

  async get(id: string): Promise<Lesson | null> {
    try {
      return JSON.parse(await fs.readFile(file(id), 'utf8')) as Lesson;
    } catch {
      return null;
    }
  },

  save(lesson: Lesson): Promise<void> {
    const snapshot = JSON.stringify({ ...lesson, updatedAt: new Date().toISOString() }, null, 2);
    const prev = writeQueues.get(lesson.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const target = file(lesson.id);
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, target);
    });
    writeQueues.set(lesson.id, next.catch(() => {}));
    return next;
  },

  async list(): Promise<LessonSummary[]> {
    const names = (await fs.readdir(DIR)).filter((n) => n.endsWith('.json'));
    const lessons = await Promise.all(names.map((n) => this.get(n.replace(/\.json$/, ''))));
    return lessons
      .filter((l): l is Lesson => !!l)
      .map((l) => ({
        id: l.id,
        title: l.plan?.title ?? l.prompt.slice(0, 80),
        prompt: l.prompt,
        createdAt: l.createdAt,
        status: l.status,
        stepCount: l.plan?.steps.length ?? 0,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async remove(id: string): Promise<void> {
    await fs.rm(file(id), { force: true });
  },
};
