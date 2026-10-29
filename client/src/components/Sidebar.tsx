import { useState } from 'react';
import type { LessonSummary } from '../../../shared/types';
import { TrashIcon } from './Icons';

interface Props {
  lessons: LessonSummary[];
  selectedId: string | null;
  busy: boolean;
  onCreate(prompt: string): Promise<void>;
  onSelect(id: string): void;
  onDelete(id: string): void;
}

const STATUS_LABEL: Record<LessonSummary['status'], string> = {
  planning: 'Planning', building: 'Building', ready: 'Ready', partial: 'Needs fixes', error: 'Failed',
};

export function Sidebar({ lessons, selectedId, busy, onCreate, onSelect, onDelete }: Props) {
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (prompt.trim().length < 3 || submitting) return;
    setSubmitting(true); setError('');
    try { await onCreate(prompt.trim()); setPrompt(''); }
    catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  };

  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark" />AnimLearn</div>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor="ask" className="eyebrow">What do you want to understand?</label>
        <textarea
          id="ask"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
          placeholder={'e.g. How does Docker work?\n\nOr paste a detailed prompt with the steps you want.'}
        />
        <button className="btn primary" type="submit" disabled={submitting || prompt.trim().length < 3}>
          {submitting ? 'Starting…' : 'Explain it'}
        </button>
        <span className="hint">Ctrl + Enter to send{busy ? ' · a lesson is generating' : ''}</span>
        {error && <p className="error-text">{error}</p>}
      </form>

      <nav className="history" aria-label="Saved lessons">
        <div className="eyebrow">History</div>
        {lessons.length === 0 && <p className="muted small">Your lessons will appear here.</p>}
        <ul>
          {lessons.map((l) => (
            <li key={l.id} className={l.id === selectedId ? 'active' : ''}>
              <button className="history-item" onClick={() => onSelect(l.id)}>
                <span className="history-title">{l.title}</span>
                <span className="history-meta">
                  <span className={`badge badge-${l.status}`}>{STATUS_LABEL[l.status]}</span>
                  {new Date(l.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {l.stepCount ? ` · ${l.stepCount} steps` : ''}
                </span>
              </button>
              <button className="history-del" title="Delete lesson" aria-label="Delete lesson"
                onClick={() => { if (confirm(`Delete “${l.title}”?`)) onDelete(l.id); }}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
