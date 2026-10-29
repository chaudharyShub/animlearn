// Small inline icons for the controls (stroke icons, 20px).
const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const PlayIcon = () => <svg {...base}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>;
export const PauseIcon = () => <svg {...base}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></svg>;
export const PrevIcon = () => <svg {...base}><path d="M15 18l-6-6 6-6" /></svg>;
export const NextIcon = () => <svg {...base}><path d="M9 18l6-6-6-6" /></svg>;
export const ReplayIcon = () => <svg {...base}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>;
export const RestartIcon = () => <svg {...base}><path d="M5 5v14" /><path d="M19 6l-9 6 9 6z" fill="currentColor" /></svg>;
export const SunIcon = () => <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const MoonIcon = () => <svg {...base}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
export const AutoIcon = () => <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg>;
export const TrashIcon = () => <svg {...base} width={16} height={16}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
export const RefreshIcon = () => <svg {...base} width={16} height={16}><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></svg>;
