import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson, Theme } from '../../../shared/types';
import { StepFrame, type StepFrameHandle } from './StepFrame';
import { ProgressTrack } from './ProgressTrack';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RefreshIcon, ReplayIcon, RestartIcon } from './Icons';

interface Props {
  lesson: Lesson;
  theme: Theme;
  live: boolean;
  onRegenerate(index: number, feedback?: string): Promise<void>;
}

/** Time to keep a finished step on screen before auto-advancing. */
function holdMs(caption: string) {
  const words = caption.split(/\s+/).length;
  return Math.min(6000, 2200 + words * 60);
}

export function Player({ lesson, theme, live, onRegenerate }: Props) {
  const plan = lesson.plan!;
  const n = plan.steps.length;
  const [slide, setSlide] = useState(-1); // -1 intro, 0..n-1 steps, n recap
  const [playing, setPlaying] = useState(false);
  const [stepProgress, setStepProgress] = useState(0);
  const [frameError, setFrameError] = useState<string | null>(null);
  const frame = useRef<StepFrameHandle>(null);
  const holdTimer = useRef<number | undefined>(undefined);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const isStep = slide >= 0 && slide < n;
  const step = isStep ? lesson.steps[slide] : undefined;
  const planStep = isStep ? plan.steps[slide] : undefined;
  const code = step?.status === 'ready' ? step.code : undefined;

  const clearHold = () => window.clearTimeout(holdTimer.current);

  const goTo = useCallback((s: number) => {
    clearHold();
    const next = Math.max(-1, Math.min(n, s));
    setSlide(next);
    if (next === n || next === -1) setPlaying(false);
  }, [n]);

  // New step or new code: reset the step state.
  useEffect(() => {
    setStepProgress(0);
    setFrameError(null);
    clearHold();
  }, [slide, code]);

  useEffect(() => () => clearHold(), []);

  const play = () => {
    if (slide === -1 || slide === n) { goTo(0); setPlaying(true); return; }
    setPlaying(true);
    if (stepProgress >= 0.999) frame.current?.restart(); else frame.current?.play();
  };
  const pause = () => { clearHold(); frame.current?.pause(); setPlaying(false); };
  const replay = () => { clearHold(); setPlaying(true); frame.current?.restart(); };
  const restartLesson = () => { goTo(0); setPlaying(true); if (slide === 0) frame.current?.restart(); };
  const seek = (p: number) => { clearHold(); setPlaying(false); frame.current?.seek(p); setStepProgress(p); };

  // Keyboard shortcuts (ignored while typing).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('textarea, input, [contenteditable]')) return;
    if (e.key === ' ') { e.preventDefault(); if (playing) pause(); else play(); }
    else if (e.key === 'ArrowRight') goTo(slide + 1);
    else if (e.key === 'ArrowLeft') goTo(slide - 1);
    else if (e.key.toLowerCase() === 'r' && isStep) replay();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const readyCount = lesson.steps.filter((s) => s.status === 'ready').length;

  return (
    <div className="player">
      <header className="player-head">
        <div>
          <h1 className="lesson-title">{plan.title}</h1>
          <p className="lesson-summary">{plan.summary}</p>
        </div>
      </header>

      <div className="player-body">
        <div className="stage-col">
          <div className="stage">
            {slide === -1 && <Intro lesson={lesson} onStart={() => { goTo(0); setPlaying(true); }} />}
            {slide === n && <Recap lesson={lesson} onSelect={(i) => goTo(i)} onAgain={restartLesson} />}
            {isStep && code && (
              <StepFrame
                ref={frame}
                code={code}
                theme={theme}
                onReady={() => { if (playingRef.current) frame.current?.play(); }}
                onProgress={setStepProgress}
                onComplete={() => {
                  setStepProgress(1);
                  if (!playingRef.current) return;
                  clearHold();
                  holdTimer.current = window.setTimeout(() => goTo(slide + 1), holdMs(planStep!.caption));
                }}
                onError={(m) => { setFrameError(m); setPlaying(false); }}
              />
            )}
            {isStep && !code && <StepPlaceholder status={step!.status} error={step!.error} />}
            {isStep && frameError && (
              <div className="stage-overlay">
                <div className="overlay-card">
                  <strong>This animation hit an error</strong>
                  <code>{frameError}</code>
                  <button className="btn" disabled={live} onClick={() => onRegenerate(slide, `The animation crashed in the player with: ${frameError}`)}>
                    <RefreshIcon /> Regenerate step
                  </button>
                </div>
              </div>
            )}
          </div>

          <ProgressTrack
            steps={lesson.steps}
            stepTitles={plan.steps.map((s) => s.title)}
            slide={slide}
            stepProgress={stepProgress}
            onSelect={goTo}
            onSeek={seek}
          />

          <div className="controls">
            <button className="icon-btn" onClick={restartLesson} title="Restart lesson" aria-label="Restart lesson"><RestartIcon /></button>
            <button className="icon-btn" onClick={() => goTo(slide - 1)} disabled={slide <= -1} title="Previous (←)" aria-label="Previous step"><PrevIcon /></button>
            {playing ? (
              <button className="icon-btn primary" onClick={pause} title="Pause (space)" aria-label="Pause"><PauseIcon /></button>
            ) : (
              <button className="icon-btn primary" onClick={play} title="Play (space)" aria-label="Play"><PlayIcon /></button>
            )}
            <button className="icon-btn" onClick={() => goTo(slide + 1)} disabled={slide >= n} title="Next (→)" aria-label="Next step"><NextIcon /></button>
            <button className="icon-btn" onClick={replay} disabled={!isStep || !code} title="Replay step (R)" aria-label="Replay step"><ReplayIcon /></button>
            <span className="controls-label">
              {slide === -1 ? 'Introduction' : slide === n ? 'Recap' : `Step ${slide + 1} of ${n}`}
              {live && <span className="muted"> · {readyCount}/{n} built</span>}
            </span>
          </div>
        </div>

        <aside className="caption-col">
          {isStep && planStep ? (
            <>
              <div className="eyebrow">Step {slide + 1} of {n}</div>
              <h2 className="caption-title">{planStep.title}</h2>
              <p className="caption-text">{planStep.caption}</p>
              <RegeneratePanel
                key={slide}
                disabled={live}
                building={step?.status === 'building'}
                warnings={step?.warnings}
                onSubmit={(fb) => onRegenerate(slide, fb)}
              />
            </>
          ) : slide === -1 ? (
            <>
              <div className="eyebrow">Introduction</div>
              <h2 className="caption-title">Before we start</h2>
              <p className="caption-text">Read the key terms first, then press play. Each step shows one idea, with its explanation here.</p>
              <p className="hint">Shortcuts: <kbd>Space</kbd> play/pause · <kbd>←</kbd> <kbd>→</kbd> steps · <kbd>R</kbd> replay</p>
            </>
          ) : (
            <>
              <div className="eyebrow">Recap</div>
              <h2 className="caption-title">What you learned</h2>
              <p className="caption-text">{plan.recap}</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Intro({ lesson, onStart }: { lesson: Lesson; onStart(): void }) {
  const plan = lesson.plan!;
  return (
    <div className="slide scroll">
      <div className="slide-inner">
        <h3 className="slide-heading">Key terms</h3>
        <dl className="terms">
          {plan.prerequisites.map((p) => (
            <div className="term" key={p.term}>
              <dt>{p.term}</dt>
              <dd>{p.explanation}</dd>
            </div>
          ))}
        </dl>
        {plan.analogy && (
          <div className="analogy">
            <div className="eyebrow">Everyday analogy</div>
            <p>{plan.analogy.text}</p>
          </div>
        )}
        <button className="btn primary big" onClick={onStart}><PlayIcon /> Start the lesson</button>
      </div>
    </div>
  );
}

function Recap({ lesson, onSelect, onAgain }: { lesson: Lesson; onSelect(i: number): void; onAgain(): void }) {
  const plan = lesson.plan!;
  return (
    <div className="slide scroll">
      <div className="slide-inner">
        <h3 className="slide-heading">The whole story</h3>
        <ol className="outline">
          {plan.steps.map((s, i) => (
            <li key={i}>
              <button className="link" onClick={() => onSelect(i)}>{s.title}</button>
              <span>{s.caption}</span>
            </li>
          ))}
        </ol>
        <button className="btn primary" onClick={onAgain}><ReplayIcon /> Watch again</button>
      </div>
    </div>
  );
}

function StepPlaceholder({ status, error }: { status: string; error?: string }) {
  return (
    <div className="slide center">
      {status === 'error' ? (
        <div className="overlay-card">
          <strong>This step could not be built</strong>
          {error && <code>{error}</code>}
          <span className="muted">Use “Regenerate this step” on the right to try again.</span>
        </div>
      ) : (
        <div className="building">
          <span className="spinner" />
          <span>{status === 'building' ? 'Building this step…' : 'Waiting to be built…'}</span>
        </div>
      )}
    </div>
  );
}

function RegeneratePanel({ disabled, building, warnings, onSubmit }: {
  disabled: boolean; building: boolean; warnings?: string[]; onSubmit(feedback?: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true); setErr('');
    try { await onSubmit(feedback.trim() || undefined); setOpen(false); setFeedback(''); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="regen">
      {!open ? (
        <button className="btn ghost" disabled={disabled || building} onClick={() => setOpen(true)}>
          <RefreshIcon /> {building ? 'Rebuilding…' : 'Regenerate this step'}
        </button>
      ) : (
        <div className="regen-form">
          <label htmlFor="fb">What should change? <span className="muted">(optional)</span></label>
          <textarea id="fb" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Show the arrows more slowly, make the boxes bigger" />
          <div className="row">
            <button className="btn primary" disabled={busy || disabled} onClick={submit}>{busy ? 'Starting…' : 'Regenerate'}</button>
            <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {err && <p className="error-text">{err}</p>}
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <details className="notes">
          <summary>Layout check: {warnings.length} note{warnings.length > 1 ? 's' : ''}</summary>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
