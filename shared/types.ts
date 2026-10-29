// Types shared by the server and the client.

export interface Prerequisite {
  term: string;
  explanation: string;
}

export interface PlanStep {
  title: string;
  /** 1–3 plain-language sentences shown next to the animation. */
  caption: string;
  visual: {
    /** What the animation should show, in prose. */
    description: string;
    /** Shapes/labels that must appear. */
    keyElements: string[];
    /** The one thing that changes or moves in this step. */
    whatChanges: string;
  };
}

export interface LessonPlan {
  title: string;
  summary: string;
  prerequisites: Prerequisite[];
  analogy: { text: string } | null;
  /** Recurring visual elements, their roles and positions, so all steps look like one story. */
  visualGuide: string;
  steps: PlanStep[];
  recap: string;
}

export type StepStatus = 'pending' | 'building' | 'ready' | 'error';

export interface StepVisual {
  status: StepStatus;
  /** Body of `function render({ svg, gsap, h, W, H })`. */
  code?: string;
  error?: string;
  attempts: number;
  /** Non-fatal layout notes from the validator. */
  warnings?: string[];
  updatedAt?: string;
}

export type LessonStatus = 'planning' | 'building' | 'ready' | 'partial' | 'error';

export interface Lesson {
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: LessonStatus;
  error?: string;
  plan?: LessonPlan;
  steps: StepVisual[];
}

export interface LessonSummary {
  id: string;
  title: string;
  prompt: string;
  createdAt: string;
  status: LessonStatus;
  stepCount: number;
}

/** Events streamed to the browser while a lesson is generated. */
export type GenerationEvent =
  | { type: 'progress'; message: string }
  | { type: 'lesson'; lesson: Lesson }
  | { type: 'done'; lesson: Lesson }
  | { type: 'failed'; message: string };

/** Messages from the player to the sandbox iframe. */
export type ToFrameMessage =
  | { type: 'load'; code: string; theme: Theme }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'restart' }
  | { type: 'seek'; progress: number }
  | { type: 'theme'; theme: Theme };

/** Messages from the sandbox iframe to the player. */
export type FromFrameMessage =
  | { type: 'ready'; duration: number }
  | { type: 'progress'; progress: number }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export type Theme = 'light' | 'dark';
