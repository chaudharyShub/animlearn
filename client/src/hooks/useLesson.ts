import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LessonWithState } from '../lib/api';

/** Loads a lesson and follows live generation progress while it is being built. */
export function useLesson(id: string | null, onFinished: () => void) {
  const [lesson, setLesson] = useState<LessonWithState | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [live, setLive] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const follow = useCallback((lessonId: string) => {
    unsubRef.current?.();
    setLive(true);
    unsubRef.current = api.events(lessonId, (e) => {
      if (e.type === 'progress') setProgress(e.message);
      else if (e.type === 'lesson') setLesson(e.lesson);
      else if (e.type === 'done') {
        setLesson(e.lesson);
        setProgress('');
        setLive(false);
        finishedRef.current();
      } else if (e.type === 'failed') {
        setError(e.message);
        setProgress('');
        setLive(false);
        api.get(lessonId).then(setLesson).catch(() => {});
        finishedRef.current();
      }
    });
  }, []);

  useEffect(() => {
    unsubRef.current?.();
    setLesson(null);
    setError('');
    setProgress('');
    setLive(false);
    if (!id) return;
    let cancelled = false;
    api
      .get(id)
      .then((l) => {
        if (cancelled) return;
        setLesson(l);
        if (l.running) follow(id);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      unsubRef.current?.();
    };
  }, [id, follow]);

  const regenerate = useCallback(
    async (index: number, feedback?: string) => {
      if (!id) return;
      setError('');
      await api.regenerate(id, index, feedback);
      follow(id);
    },
    [id, follow],
  );

  return { lesson, progress, error, live, regenerate, follow };
}
