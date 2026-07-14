// Preferencias de UI persistidas en localStorage (tema, zoom, corrector).

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'iur-theme';
const ZOOM_KEY = 'iur-zoom';
const SPELL_KEY = 'iur-spellcheck';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

const applyThemeClass = (theme: Theme) => {
  const dark = theme === 'dark' || (theme === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
};

export const getTheme = (): Theme => {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
};

export const setTheme = (theme: Theme): void => {
  localStorage.setItem(THEME_KEY, theme);
  applyThemeClass(theme);
  // En modo sistema, seguir los cambios del SO en vivo.
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mediaListener) mq.removeEventListener('change', mediaListener);
  mediaListener = null;
  if (theme === 'system') {
    mediaListener = () => applyThemeClass('system');
    mq.addEventListener('change', mediaListener);
  }
};

export const initTheme = (): void => setTheme(getTheme());

// ---------- zoom ----------

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

export const getZoom = (): number => {
  const v = parseFloat(localStorage.getItem(ZOOM_KEY) || '1');
  return Number.isFinite(v) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v)) : 1;
};

export const setZoom = (zoom: number): number => {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 10) / 10));
  localStorage.setItem(ZOOM_KEY, String(clamped));
  return clamped;
};

// ---------- corrector ortográfico ----------

export const getSpellcheck = (): boolean => localStorage.getItem(SPELL_KEY) !== 'false';

export const setSpellcheck = (enabled: boolean): void => {
  localStorage.setItem(SPELL_KEY, String(enabled));
};
