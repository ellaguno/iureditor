import type { HeadingInfo } from '../lib/outline';
import { t } from '../lib/i18n';

// Esquema del documento (encabezados). Clic = saltar. Vive dentro del
// Sidebar, que aporta ancho, borde y fondo.
export const OutlinePanel = ({
  headings,
  onSelect,
}: {
  headings: HeadingInfo[];
  onSelect: (heading: HeadingInfo) => void;
}) => (
  <div className="h-full overflow-y-auto py-2">
    {headings.length === 0 ? (
      <div className="px-3 py-1 text-xs italic text-gray-400 dark:text-gray-500">
        {t('outline.empty')}
      </div>
    ) : (
      headings.map((h, i) => (
        <button
          key={`${h.pos}-${i}`}
          type="button"
          onClick={() => onSelect(h)}
          title={h.text}
          style={{ paddingLeft: `${12 + (h.level - 1) * 12}px` }}
          className={`w-full pr-3 py-1 text-left text-sm truncate text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70 ${
            h.level === 1 ? 'font-semibold' : h.level === 2 ? 'font-medium' : ''
          }`}
        >
          {h.text || '…'}
        </button>
      ))
    )}
  </div>
);
