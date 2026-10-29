import type { StepVisual } from '../../../shared/types';

interface Props {
  steps: StepVisual[];
  stepTitles: string[];
  /** -1 = intro, 0..n-1 = steps, n = recap */
  slide: number;
  stepProgress: number;
  onSelect(slide: number): void;
  onSeek(progress: number): void;
}

/** Segmented progress: Intro | step 1 … step N | Recap. The current segment fills as the animation plays. */
export function ProgressTrack({ steps, stepTitles, slide, stepProgress, onSelect, onSeek }: Props) {
  const n = steps.length;
  const segments = [
    { key: 'intro', label: 'Intro', slide: -1, state: 'ready' as const },
    ...steps.map((s, i) => ({ key: `s${i}`, label: `${i + 1}. ${stepTitles[i] ?? ''}`, slide: i, state: s.status })),
    { key: 'recap', label: 'Recap', slide: n, state: 'ready' as const },
  ];

  return (
    <div className="track" role="group" aria-label="Lesson progress">
      {segments.map((seg) => {
        const done = seg.slide < slide;
        const current = seg.slide === slide;
        const fill = done ? 1 : current ? (seg.slide >= 0 && seg.slide < n ? stepProgress : 1) : 0;
        const isStep = seg.slide >= 0 && seg.slide < n;
        return (
          <button
            key={seg.key}
            className={`track-seg ${isStep ? 'is-step' : 'is-edge'} state-${seg.state} ${current ? 'is-current' : ''}`}
            title={seg.label}
            aria-label={seg.label}
            aria-current={current ? 'step' : undefined}
            onClick={(e) => {
              if (current && isStep) {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
              } else onSelect(seg.slide);
            }}
          >
            <span className="track-fill" style={{ transform: `scaleX(${fill})` }} />
          </button>
        );
      })}
    </div>
  );
}
