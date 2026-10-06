import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Columns, RowsIcon, X, Trash2 } from 'lucide-react';
import { t } from '../lib/i18n';
import { useDropdownClamp } from '../lib/useDropdownClamp';

const ITEM =
  'w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2';

const GRID_COLS = 8;
const GRID_ROWS = 6;

export const TableMenu = ({
  editor,
  isOpen,
  onClose,
}: {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
}) => {
  const { ref, alignClass } = useDropdownClamp(isOpen);
  // Selector de tamaño: se pasa el ratón por la cuadrícula y se hace clic en
  // la celda inferior derecha de la tabla deseada.
  const [hover, setHover] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 });

  if (!isOpen || !editor) return null;

  const insertTable = (rows: number, cols: number) => {
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    onClose();
  };

  return (
    <div
      ref={ref}
      className={`absolute top-full ${alignClass} mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 min-w-[180px]`}
    >
      <div className="px-3 pt-1.5 pb-2">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1.5">
          {t('table.size', { rows: hover.rows, cols: hover.cols })}
        </div>
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1rem)` }}
          onMouseLeave={() => setHover({ rows: 3, cols: 3 })}
        >
          {Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => {
            const r = Math.floor(i / GRID_COLS) + 1;
            const c = (i % GRID_COLS) + 1;
            const active = r <= hover.rows && c <= hover.cols;
            return (
              <button
                key={i}
                type="button"
                aria-label={t('table.size', { rows: r, cols: c })}
                onMouseEnter={() => setHover({ rows: r, cols: c })}
                onClick={() => insertTable(r, c)}
                className={`w-4 h-4 rounded-sm border ${
                  active
                    ? 'bg-primary-200 dark:bg-primary-800 border-primary-400 dark:border-primary-600'
                    : 'bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-600'
                }`}
              />
            );
          })}
        </div>
      </div>
      {editor.can().addColumnAfter() && (
        <>
          <div className="h-px bg-gray-200 dark:bg-gray-700 my-1" />
          <button
            onClick={() => {
              editor.chain().focus().addColumnAfter().run();
              onClose();
            }}
            className={ITEM}
          >
            <Columns className="w-4 h-4" />
            {t('editor.addColumn')}
          </button>
          <button
            onClick={() => {
              editor.chain().focus().addRowAfter().run();
              onClose();
            }}
            className={ITEM}
          >
            <RowsIcon className="w-4 h-4" />
            {t('editor.addRow')}
          </button>
          <button
            onClick={() => {
              editor.chain().focus().deleteColumn().run();
              onClose();
            }}
            className={ITEM}
          >
            <X className="w-4 h-4" />
            {t('editor.deleteColumn')}
          </button>
          <button
            onClick={() => {
              editor.chain().focus().deleteRow().run();
              onClose();
            }}
            className={ITEM}
          >
            <X className="w-4 h-4" />
            {t('editor.deleteRow')}
          </button>
          <button
            onClick={() => {
              editor.chain().focus().deleteTable().run();
              onClose();
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {t('editor.deleteTable')}
          </button>
        </>
      )}
    </div>
  );
};
