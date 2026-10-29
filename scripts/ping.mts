import { createEngine } from '../server/src/ai/engine.ts';
const e = createEngine();
console.log(await e.complete({ system: 'Reply tersely.', prompt: 'Say OK and nothing else.', label: 'ping' }));
