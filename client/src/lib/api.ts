import type { GenerationEvent, Lesson, LessonSummary } from '../../../shared/types';

export type LessonWithState = Lesson & { running?: boolean };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  list: () => request<LessonSummary[]>('/api/lessons'),
  get: (id: string) => request<LessonWithState>(`/api/lessons/${id}`),
  create: (prompt: string) => request<Lesson>('/api/lessons', { method: 'POST', body: JSON.stringify({ prompt }) }),
  remove: (id: string) => request<void>(`/api/lessons/${id}`, { method: 'DELETE' }),
  regenerate: (id: string, index: number, feedback?: string) =>
    request<{ ok: true }>(`/api/lessons/${id}/steps/${index}/regenerate`, { method: 'POST', body: JSON.stringify({ feedback }) }),

  /** Subscribes to live generation events. Returns an unsubscribe function. */
  events(id: string, onEvent: (e: GenerationEvent) => void): () => void {
    const es = new EventSource(`/api/lessons/${id}/events`);
    es.onmessage = (m) => {
      const event = JSON.parse(m.data) as GenerationEvent;
      onEvent(event);
      if (event.type === 'done' || event.type === 'failed') es.close();
    };
    es.onerror = () => {
      // The server closes the stream when generation ends; EventSource would otherwise reconnect forever.
      if (es.readyState === EventSource.CLOSED) return;
      es.close();
      onEvent({ type: 'failed', message: 'Lost connection to the server.' });
    };
    return () => es.close();
  },
};
