import { writeFileSync } from 'node:fs';
import { EXAMPLE } from '../server/src/pipeline/prompts.ts';
import { validateStep, screenshotStep, closeValidator } from '../server/src/validate/validator.ts';
console.log(JSON.stringify(await validateStep(EXAMPLE), null, 1));
const [a] = await screenshotStep(EXAMPLE, 'light', [1]);
writeFileSync('../scripts/out/example.png', a);
await closeValidator();
