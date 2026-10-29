import { readFileSync } from 'node:fs';
import { validateStep, closeValidator } from '../server/src/validate/validator.ts';
for (const id of process.argv.slice(2)) {
  const l = JSON.parse(readFileSync(`data/lessons/${id}.json`, 'utf8'));
  console.log('#', l.plan.title);
  for (const [i, s] of l.steps.entries()) {
    const v = await validateStep(s.code);
    console.log(`  ${i + 1}: ${v.ok ? v.issues.length + ' issues' : 'ERROR ' + v.error}${v.issues.map((x) => '\n     - ' + x).join('')}`);
  }
}
await closeValidator();
