import { useCallback, useEffect, useState } from 'react';
import type { LessonSummary } from '../../shared/types';
import { api } from './lib/api';
import { useTheme } from './hooks/useTheme';
import { useLesson } from './hooks/useLesson';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/Player';
import { AutoIcon, MoonIcon, SunIcon } from './components/Icons';

function readHash() {
  const m = window.location.hash.match(/^#\/lesson\/([\w-]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const { theme, choice, cycle } = useTheme();
  const [lessons, setLessons] = useState<LessonSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readHash);

  const refreshList = useCallback(() => {
    api.list().then(setLessons).catch(() => {});
  }, []);

  const { lesson, progress, error, live, regenerate } = useLesson(selectedId, refreshList);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEffect(() => {
    const onHash = () => setSelectedId(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: string | null) => {
    window.location.hash = id ? `/lesson/${id}` : '';
    setSelectedId(id);
  };

  const create = async (prompt: string) => {
    const l = await api.create(prompt);
    refreshList();
    select(l.id);
  };

  const remove = async (id: string) => {
    await api.remove(id).catch((e: Error) => alert(e.message));
    if (id === selectedId) select(null);
    refreshList();
  };

  // Keep the history badges in sync while generating.
  useEffect(() => { if (live) refreshList(); }, [live, lesson?.status, refreshList]);

  const themeLabel = choice === 'system' ? 'Theme: system' : `Theme: ${choice}`;

  return (
    <div className="app">
      <Sidebar
        lessons={lessons}
        selectedId={selectedId}
        busy={live}
        onCreate={create}
        onSelect={select}
        onDelete={remove}
      />
      <main className="main">
        <div className="topbar">
          {live && progress ? (
            <div className="gen-status" role="status"><span className="spinner small" />{progress}</div>
          ) : <span />}
          <button className="icon-btn" onClick={cycle} title={themeLabel} aria-label={themeLabel}>
            {choice === 'system' ? <AutoIcon /> : choice === 'light' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>

        {error && <div className="banner error">{error}</div>}

        {!selectedId && <Welcome />}

        {selectedId && lesson && !lesson.plan && (
          <div className="center-panel">
            {lesson.status === 'error' ? (
              <div className="overlay-card">
                <strong>Could not create this lesson</strong>
                <code>{lesson.error}</code>
                <button className="btn primary" onClick={() => create(lesson.prompt)}>Try again</button>
              </div>
            ) : (
              <div className="building big">
                <span className="spinner" />
                <span>{progress || 'Planning lesson…'}</span>
                <p className="muted prompt-echo">“{lesson.prompt.length > 200 ? lesson.prompt.slice(0, 200) + '…' : lesson.prompt}”</p>
              </div>
            )}
          </div>
        )}

        {lesson?.plan && (
          <Player key={lesson.id} lesson={lesson} theme={theme} live={live} onRegenerate={regenerate} />
        )}
      </main>
    </div>
  );
}

function Welcome() {
  return (
    <div className="center-panel">
      <div className="welcome">
        <h1>Learn anything, step by step</h1>
        <p>Ask a question on the left, such as <em>“How does React reconciliation work?”</em> or <em>“How does Docker work?”</em>.
          You’ll get a beginner-friendly animated lesson you can play, pause and step through.</p>
        <p className="muted">Lessons are saved on this computer and appear in your history.</p>
      </div>
    </div>
  );
}
