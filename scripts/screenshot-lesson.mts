// Usage: npx tsx scripts/screenshot-lesson.mts <lessonId> [outName]
// Saves end-state screenshots (light + dark) and a mid-animation shot for every ready step.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { screenshotStep, validateStep, closeValidator } from '../server/src/validate/validator.ts';
const id = process.argv[2];
const name = process.argv[3] ?? id;
const lesson = JSON.parse(readFileSync(`data/lessons/${id}.json`, 'utf8'));
const out = `scripts/out/${name}`;
mkdirSync(out, { recursive: true });
console.log(`# ${lesson.plan?.title} [${lesson.status}]`);
for (const [i, s] of lesson.steps.entries()) {
  const t = lesson.plan.steps[i].title;
  if (s.status !== 'ready') { console.log(`step ${i + 1} ${t}: ${s.status} ${s.error ?? ''}`); continue; }
  const v = await validateStep(s.code);
  console.log(`step ${i + 1} ${t}: attempts=${s.attempts} dur=${v.duration?.toFixed(1)}s issues=${v.issues.length}${v.issues.length ? '\n   - ' + v.issues.join('\n   - ') : ''}`);
  const [mid, end] = await screenshotStep(s.code, 'light', [0.45, 1]);
  writeFileSync(`${out}/${String(i + 1).padStart(2, '0')}-mid.png`, mid);
  writeFileSync(`${out}/${String(i + 1).padStart(2, '0')}-end.png`, end);
  const [dark] = await screenshotStep(s.code, 'dark', [1]);
  writeFileSync(`${out}/${String(i + 1).padStart(2, '0')}-dark.png`, dark);
}
await closeValidator();
