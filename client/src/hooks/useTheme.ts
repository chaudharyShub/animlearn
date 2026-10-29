import { useEffect, useState } from 'react';
import type { Theme } from '../../../shared/types';

export type ThemeChoice = 'system' | Theme;

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem('animlearn.theme');
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage unavailable */ }
  return 'system';
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const [system, setSystem] = useState<Theme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = choice === 'system' ? system : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('animlearn.theme', choice); } catch { /* ignore */ }
  }, [theme, choice]);

  const cycle = () => setChoice((c) => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system'));
  return { theme, choice, cycle };
}
