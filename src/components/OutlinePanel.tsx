import { useEffect, useRef } from 'react';
import type { HeadingInfo } from '../lib/outline';
import { activeHeadingIndex } from '../lib/outline';
import { t } from '../lib/i18n';

// Esquema del documento (encabezados). Clic = saltar. Vive dentro del
// Sidebar, que aporta ancho, borde y fondo. La sección donde está el cursor
// (o la visible al hacer scroll) se resalta y se mantiene a la vista.
export const OutlinePanel = ({
  headings,
  activePos,
  onSelect,
}: {
  headings: HeadingInfo[];
  /** Posición del documento que define la sección activa (cursor o scroll). */
  activePos: number;
  onSelect: (heading: HeadingInfo) => void;
}) => {
  const active = activeHeadingIndex(headings, activePos);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className="h-full overflow-y-auto py-2">
      {headings.length === 0 ? (
        <div className="px-3 py-1 text-xs italic text-gray-400 dark:text-gray-500">
          {t('outline.empty')}
        </div>
      ) : (
        headings.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            ref={i === active ? activeRef : null}
            type="button"
            onClick={() => onSelect(h)}
            title={h.text}
            style={{ paddingLeft: `${12 + (h.level - 1) * 12}px` }}
            className={`w-full pr-3 py-1 text-left text-sm truncate border-l-2 ${
              h.level === 1 ? 'font-semibold' : h.level === 2 ? 'font-medium' : ''
            } ${
              i === active
                ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 border-primary-500'
                : 'border-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70'
            }`}
          >
            {h.text || '…'}
          </button>
        ))
      )}
    </div>
  );
};
