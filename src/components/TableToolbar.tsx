import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { TableMap } from '@tiptap/pm/tables';
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  AlignLeft,
  AlignCenter,
  AlignRight,
  PanelTop,
  Trash2,
  X,
} from 'lucide-react';
import { ToolbarButton, ToolbarDivider } from './ToolbarButton';
import { t, useLang } from '../lib/i18n';

type ColumnAlign = 'left' | 'center' | 'right';

// Alineación de TODA la columna del cursor (en markdown la alineación es por
// columna: `:---:` en la fila separadora), aplicada a los párrafos de cada
// celda. Las celdas con rowspan se tocan una sola vez.
const alignColumn = (editor: Editor, align: ColumnAlign): void => {
  const { state } = editor;
  const { $from } = state.selection;
  let tableDepth = -1;
  let cellDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (cellDepth < 0 && (name === 'tableCell' || name === 'tableHeader')) cellDepth = d;
    if (name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth < 0 || cellDepth < 0) return;
  const table = $from.node(tableDepth);
  const tableStart = $from.start(tableDepth);
  const map = TableMap.get(table);
  const rect = map.findCell($from.before(cellDepth) - tableStart);
  const tr = state.tr;
  const seen = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    const cellOffset = map.map[row * map.width + rect.left];
    if (seen.has(cellOffset)) continue;
    seen.add(cellOffset);
    const cell = table.nodeAt(cellOffset);
    if (!cell) continue;
    const cellAbs = tableStart + cellOffset;
    cell.forEach((child, offset) => {
      if (child.type.name === 'paragraph' || child.type.name === 'heading') {
        tr.setNodeMarkup(cellAbs + 1 + offset, undefined, { ...child.attrs, textAlign: align });
      }
    });
  }
  editor.view.dispatch(tr);
};

/**
 * Barra contextual de tabla: aparece bajo la barra de herramientas mientras
 * el cursor está dentro de una tabla. Antes las operaciones de fila/columna
 * sólo estaban escondidas en el menú del botón de tabla.
 */
export const TableToolbar = ({ editor }: { editor: Editor }) => {
  useLang();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      inTable: e.isActive('table'),
      align: (e.getAttributes('paragraph').textAlign as string | undefined) || 'left',
    }),
  });
  if (!state.inTable) return null;

  const run = (cb: () => void) => () => {
    cb();
    editor.commands.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 bg-gray-50 dark:bg-gray-800/70 border-b border-gray-200 dark:border-gray-700 no-select">
      <ToolbarButton onClick={() => editor.chain().focus().addRowBefore().run()} title={t('table.rowAbove')}>
        <ArrowUpToLine className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} title={t('table.rowBelow')}>
        <ArrowDownToLine className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} title={t('table.deleteRow')}>
        <X className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton onClick={() => editor.chain().focus().addColumnBefore().run()} title={t('table.colLeft')}>
        <ArrowLeftToLine className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} title={t('table.colRight')}>
        <ArrowRightToLine className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} title={t('table.deleteCol')}>
        <X className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        onClick={run(() => alignColumn(editor, 'left'))}
        isActive={state.align === 'left'}
        title={t('table.alignLeft')}
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={run(() => alignColumn(editor, 'center'))}
        isActive={state.align === 'center'}
        title={t('table.alignCenter')}
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={run(() => alignColumn(editor, 'right'))}
        isActive={state.align === 'right'}
        title={t('table.alignRight')}
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeaderRow().run()}
        isActive={editor.isActive('tableHeader')}
        title={t('table.headerRow')}
      >
        <PanelTop className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} title={t('table.delete')}>
        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
      </ToolbarButton>
    </div>
  );
};
