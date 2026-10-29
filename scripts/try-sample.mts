import { readFileSync, writeFileSync } from 'node:fs';
import { validateStep, screenshotStep, closeValidator } from '../server/src/validate/validator.ts';
const code = readFileSync(process.argv[2], 'utf8');
console.log(JSON.stringify(await validateStep(code), null, 2));
for (const theme of ['light', 'dark'] as const) {
  const [a] = await screenshotStep(code, theme, [1]);
  writeFileSync(`../scripts/out/sample-${theme}.png`, a);
}
await closeValidator();
