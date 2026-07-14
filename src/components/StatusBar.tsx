import { t } from '../lib/i18n';

// Barra de estado: conteo de palabras/caracteres, zoom y estado de guardado.
export const StatusBar = ({
  words,
  chars,
  dirty,
  hasFile,
  zoom,
}: {
  words: number;
  chars: number;
  dirty: boolean;
  hasFile: boolean;
  zoom: number;
}) => (
  <div className="flex items-center gap-4 px-3 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 no-select shrink-0">
    <span className="tabular-nums">
      {words.toLocaleString()} {t('status.words')}
    </span>
    <span className="tabular-nums">
      {chars.toLocaleString()} {t('status.chars')}
    </span>
    {zoom !== 1 && <span className="tabular-nums">{Math.round(zoom * 100)}%</span>}
    <div className="flex-1" />
    <span className={dirty ? 'text-amber-600 dark:text-amber-400' : ''}>
      {dirty ? `• ${t('status.unsaved')}` : hasFile ? t('status.saved') : ''}
    </span>
  </div>
);
