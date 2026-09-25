import { t, locale } from '../lib/i18n';

// Barra de estado: línea del cursor, conteo de palabras/caracteres, zoom y
// estado de guardado.
export const StatusBar = ({
  line,
  words,
  chars,
  dirty,
  hasFile,
  zoom,
}: {
  /** Línea (1-based) donde está el cursor. */
  line: number;
  words: number;
  chars: number;
  dirty: boolean;
  hasFile: boolean;
  zoom: number;
}) => (
  <div className="flex items-center gap-4 px-3 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 no-select shrink-0">
    <span className="tabular-nums">
      {t('status.line')} {line.toLocaleString(locale())}
    </span>
    <span className="tabular-nums">
      {words.toLocaleString(locale())} {t('status.words')}
    </span>
    <span className="tabular-nums">
      {chars.toLocaleString(locale())} {t('status.chars')}
    </span>
    {zoom !== 1 && <span className="tabular-nums">{Math.round(zoom * 100)}%</span>}
    <div className="flex-1" />
    <span className={dirty ? 'text-amber-600 dark:text-amber-400' : ''}>
      {dirty ? `• ${t('status.unsaved')}` : hasFile ? t('status.saved') : ''}
    </span>
  </div>
);
