import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiKeyWarning, createEngine } from './ai/engine.js';
import { lessonStore } from './storage/lessonStore.js';
import { recoverInterrupted, regenerateStep, startLesson, subscribe, isRunning } from './pipeline/jobs.js';
import { sandboxHtml } from './sandboxPage.js';
import { closeValidator } from './validate/validator.js';
import type { GenerationEvent } from '../../shared/types.js';

const PORT = Number(process.env.PORT) || 3001;
const here = path.dirname(fileURLToPath(import.meta.url));

checkApiKeyWarning();
const engine = createEngine();
await lessonStore.init();
await recoverInterrupted();

const app = express();
app.use(express.json({ limit: '200kb' }));

// Only accept requests from this machine.
app.use((req, res, next) => {
  const ip = req.socket.remoteAddress ?? '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return res.status(403).end();
  next();
});

app.get('/sandbox/frame.html', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(sandboxHtml());
});

app.get('/api/lessons', async (_req, res) => {
  res.json(await lessonStore.list());
});

app.post('/api/lessons', async (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim();
  if (prompt.length < 3) return res.status(400).json({ error: 'Please type a question.' });
  if (prompt.length > 20000) return res.status(400).json({ error: 'The prompt is too long (max 20,000 characters).' });
  const lesson = await startLesson(engine, prompt);
  res.status(201).json(lesson);
});

app.get('/api/lessons/:id', async (req, res) => {
  const lesson = await lessonStore.get(req.params.id).catch(() => null);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  res.json({ ...lesson, running: isRunning(lesson.id) });
});

app.delete('/api/lessons/:id', async (req, res) => {
  if (isRunning(req.params.id)) return res.status(409).json({ error: 'Lesson is still generating.' });
  await lessonStore.remove(req.params.id).catch(() => {});
  res.status(204).end();
});

app.post('/api/lessons/:id/steps/:index/regenerate', async (req, res) => {
  const lesson = await lessonStore.get(req.params.id).catch(() => null);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  try {
    await regenerateStep(engine, lesson, Number(req.params.index), req.body?.feedback);
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Server-sent events with live progress for a lesson being generated.
app.get('/api/lessons/:id/events', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (e: GenerationEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const unsubscribe = subscribe(req.params.id, (e) => {
    send(e);
    if (e.type === 'done' || e.type === 'failed') res.end();
  });
  if (!unsubscribe) {
    const lesson = await lessonStore.get(req.params.id).catch(() => null);
    if (lesson) send({ type: 'done', lesson });
    else send({ type: 'failed', message: 'Lesson not found' });
    return res.end();
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// Serve the built client (npm run build) when it exists.
const clientDist = path.resolve(here, '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`AnimLearn server on http://localhost:${PORT}  (AI engine: ${engine.name}, lessons in ${lessonStore.dir})`);
});

const shutdown = async () => {
  server.close();
  await closeValidator();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
