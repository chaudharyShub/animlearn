# AnimLearn

A personal web app that explains any technical concept as an animated, step-by-step visual lesson.
Type a question (or paste a detailed prompt), and Claude plans a beginner-friendly lesson and draws an
animation for each step. Runs locally; uses your Claude Code subscription login.

## Requirements

- Node.js 20+ (tested on 24)
- Claude Code installed and logged in (`claude` works in a terminal)
- **Do not set `ANTHROPIC_API_KEY`**: it would bill the paid API instead of your subscription.
  The server warns at startup if it is set, and removes it from the Claude subprocess.

## Setup

```bash
npm install
npx playwright install chromium   # headless browser used to check generated animations (~150 MB)
```

## Run

```bash
npm run build && npm start   # app at http://localhost:3001
# or, while editing code:
npm run dev                  # app at http://localhost:5173 (API on :3001)
```

Lessons are saved in `data/lessons/` (one JSON file each) and appear in the History list.

## Using it

- **Ask**: type a question, then press *Explain it* (or Ctrl+Enter). A new lesson takes about 5–8 minutes:
  about 1 minute to plan, then the steps are built 3 at a time. You can start watching once the plan appears.
- **Player**: play/pause, previous/next, replay step, restart lesson. Click the progress bar to jump to
  a step, or click inside the current step's bar to scrub through it. Shortcuts: `Space`, `←` `→`, `R`.
- **Theme**: the button at the top right cycles system / light / dark. Animations redraw in the new palette.
- **Regenerate this step**: rebuilds one step, with an optional note ("bigger boxes", "slower").
  If it fails, the previous version is kept.

Every generation uses Claude calls on your subscription. Each step costs 1–3 calls.

## How it works

```
Browser (React + Vite)                         Server (Express, :3001)
  Prompt · History · Player shell   ──HTTP/SSE──▶  /api/lessons …  (progress via server-sent events)
  └ <iframe sandbox="allow-scripts">               pipeline: Stage 1 plan → Stage 2 steps
      runs one step's code                        ai/engine.ts   ← the only module that calls Claude
                                                  validator: headless Chromium checks each step
                                                  storage: data/lessons/*.json
```

1. **Stage 1: plan** (`server/src/pipeline/planLesson.ts`). Claude returns JSON with the title, prerequisites,
   an optional analogy, a visual guide, 6–12 steps (title, caption, visual description) and a recap. The JSON
   is validated with zod, and Claude is asked again (up to 2 times) if it doesn't match.
2. **Stage 2: animate** (`server/src/pipeline/buildStep.ts`). Step 1 is built first, then the others in
   parallel, using step 1 as a style reference. Each step's code is run in headless Chromium and checked for
   runtime errors, empty scenes, overlapping or off-canvas shapes and text, labels that don't fit,
   arrows through shapes, crossing arrows and dangling arrows. Problems go back to Claude for up to 2 retries.
   If only minor layout issues remain, the cleanest attempt is kept and its issues are shown as "Layout check" notes.

All prompts live in `server/src/pipeline/prompts.ts`.

### Animation contract

Claude writes only the body of `function render({ svg, gsap, h, W, H })` and returns a paused GSAP timeline.
The canvas is 960×540. `h` is a small drawing kit (`sandbox/runtime.js`): `box`, `container`, `arrow`, `tree`,
`code`, `note`, `token`, `icon`, plus animation helpers (`reveal`, `draw`, `recolor`, `highlight`, `flow`,
`swapText`, …). Colours are semantic roles only (`neutral`, `active`, `new`, `old`, `danger`, `accent`, `muted`),
with one palette for light mode and one for dark.

The player and the iframe talk only through `postMessage`: `load`, `play`, `pause`, `restart`, `seek` and `theme`
go in; `ready`, `progress`, `complete` and `error` come back. The frame page has a CSP that blocks all network
access, and the iframe has no same-origin access.

### Swapping the AI engine

Implement the `AiEngine` interface in `server/src/ai/engine.ts` and return it from `createEngine()`.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Server port |
| `ANIMLEARN_MODEL` | Claude Code default | Model for all calls, e.g. `opus` or `sonnet` |
| `ANIMLEARN_CONCURRENCY` | `3` | Steps built in parallel (lower it if memory is tight) |
| `ANIMLEARN_DATA_DIR` | `data/lessons` | Where lessons are stored |

## Project layout

```
shared/types.ts          types shared by server and client
sandbox/runtime.js       drawing helpers, palettes, player bridge, layout inspector (runs in the iframe)
server/src/
  index.ts               routes + SSE
  ai/engine.ts           Claude Agent SDK call (subscription login, no tools)
  pipeline/              prompts, Stage 1, Stage 2, background jobs
  validate/validator.ts  headless Chromium checks + screenshots
  storage/lessonStore.ts JSON file storage
  sandboxPage.ts         builds the iframe page (GSAP + runtime inlined, strict CSP)
client/src/              React app: Sidebar, Player, StepFrame, ProgressTrack
scripts/                 dev tools (no generation): screenshot-lesson, recheck, player-test
```

## Dev scripts

These never generate anything. They only re-check or screenshot existing lessons.

```bash
npx tsx scripts/recheck.mts <lessonId>                 # re-run the layout checker on saved steps
npx tsx scripts/screenshot-lesson.mts <lessonId> name  # PNGs of every step (light, dark, mid-animation)
npx tsx scripts/player-test.mts                        # click-through test of the player (server must be running)
```

## Troubleshooting

- **"Could not start headless Chromium"**: run `npx playwright install chromium`.
- **Browser crashes / low memory**: set `ANIMLEARN_CONCURRENCY=1`. A crash affects only the step being
  checked, never the whole lesson.
- **Server stopped mid-generation**: on restart, unfinished steps are marked as failed. Use
  *Regenerate this step* for each one.
