import type { Editor } from '@tiptap/react';
import { Table as TableIcon, Columns, RowsIcon, X, Trash2 } from 'lucide-react';
import { t } from '../lib/i18n';
import { useDropdownClamp } from '../lib/useDropdownClamp';

const ITEM =
  'w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2';

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

  if (!isOpen || !editor) return null;

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    onClose();
  };

  return (
    <div
      ref={ref}
      className={`absolute top-full ${alignClass} mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1 min-w-[180px]`}
    >
      <button onClick={insertTable} className={ITEM}>
        <TableIcon className="w-4 h-4" />
        {t('editor.insertTable')}
      </button>
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
