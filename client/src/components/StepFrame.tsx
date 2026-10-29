import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { FromFrameMessage, Theme, ToFrameMessage } from '../../../shared/types';

export interface StepFrameHandle {
  play(): void;
  pause(): void;
  restart(): void;
  seek(progress: number): void;
}

interface Props {
  code: string;
  theme: Theme;
  onReady(duration: number): void;
  onProgress(progress: number): void;
  onComplete(): void;
  onError(message: string): void;
}

/**
 * Runs generated step code in a sandboxed iframe (scripts only: no same-origin access,
 * no forms, no popups, no top navigation). Talks to it only through postMessage.
 */
export const StepFrame = forwardRef<StepFrameHandle, Props>(function StepFrame(props, ref) {
  const { code, theme } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadedRef = useRef(false);
  const cbRef = useRef(props);
  cbRef.current = props;
  const themeRef = useRef(theme);

  const send = useCallback((msg: ToFrameMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  useImperativeHandle(ref, () => ({
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    restart: () => send({ type: 'restart' }),
    seek: (progress) => send({ type: 'seek', progress }),
  }), [send]);

  // Messages coming back from the frame. Only trust our own iframe.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const m = e.data as FromFrameMessage;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') cbRef.current.onReady(Number(m.duration) || 0);
      else if (m.type === 'progress') cbRef.current.onProgress(Number(m.progress) || 0);
      else if (m.type === 'complete') cbRef.current.onComplete();
      else if (m.type === 'error') cbRef.current.onError(String(m.message).slice(0, 500));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Load new code into the frame.
  useEffect(() => {
    if (loadedRef.current) send({ type: 'load', code, theme: themeRef.current });
  }, [code, send]);

  // Theme switch: the frame redraws in the new palette and keeps its position.
  useEffect(() => {
    if (themeRef.current === theme) return;
    themeRef.current = theme;
    if (loadedRef.current) send({ type: 'theme', theme });
  }, [theme, send]);

  return (
    <iframe
      ref={iframeRef}
      className="step-frame"
      title="Step animation"
      src="/sandbox/frame.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={() => {
        loadedRef.current = true;
        send({ type: 'load', code: cbRef.current.code, theme: themeRef.current });
      }}
    />
  );
});
