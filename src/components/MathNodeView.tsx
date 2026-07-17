import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { renderMathHtml } from '../lib/katex';
import { t } from '../lib/i18n';

// NodeView compartido para fórmulas KaTeX inline y de bloque: render en vivo,
// clic (inline) / doble clic (bloque) para editar el LaTeX en el sitio.
export const MathNodeView = ({
  node,
  updateAttributes,
  selected,
  deleteNode,
}: NodeViewProps) => {
  const latex: string = node.attrs.latex || '';
  const isBlock = node.type.name === 'mathBlock';
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Una fórmula recién insertada (vacía) abre directamente el editor.
  const [editing, setEditing] = useState(latex === '');
  const [draft, setDraft] = useState(latex);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!latex.trim()) {
      setHtml('');
      setError(null);
      return;
    }
    renderMathHtml(latex, isBlock)
      .then((rendered) => {
        if (cancelled) return;
        setHtml(rendered);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHtml('');
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [latex, isBlock]);

  useEffect(() => {
    if (editing) {
      setDraft(latex);
      setTimeout(() => (isBlock ? textareaRef.current : inputRef.current)?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const apply = () => {
    updateAttributes({ latex: draft });
    setEditing(false);
  };

  const cancel = () => {
    setEditing(false);
    // Nodo nuevo cancelado sin contenido: se queda como "fórmula vacía".
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') cancel();
    if (e.key === 'Enter' && (!isBlock || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      apply();
    }
    e.stopPropagation();
  };

  // Menú contextual (botón derecho): Editar / Borrar. Sustituye al menú
  // nativo del webview (que sólo ofrecía "Inspeccionar elemento").
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = (e: React.MouseEvent) => {
    if (editing) return; // en modo edición se deja el menú nativo (pegar, etc.)
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Se renderiza en document.body (portal): evita el anidado inválido de un
  // div dentro del wrapper inline (<span>) y los recortes por overflow.
  const contextMenu =
    menu &&
    createPortal(
      <div
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        style={{
          left: Math.min(menu.x, window.innerWidth - 160),
          top: Math.min(menu.y, window.innerHeight - 90),
        }}
        className="fixed z-50 min-w-[140px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl"
      >
        <button
          type="button"
          onClick={() => {
            setMenu(null);
            setEditing(true);
          }}
          className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
        >
          <Pencil className="w-4 h-4 opacity-70" />
          {t('math.edit')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMenu(null);
            deleteNode();
          }}
          className="w-full px-3 py-1.5 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4 opacity-70" />
          {t('math.delete')}
        </button>
      </div>,
      document.body
    );

  const ring = selected ? 'ring-2 ring-primary-300 dark:ring-primary-700' : '';

  if (isBlock) {
    return (
      <NodeViewWrapper
        className={`iur-math-block group relative my-3 rounded-lg border ${
          selected ? 'border-primary-400' : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700'
        } ${ring}`}
        data-math-block
        onContextMenu={openMenu}
      >
        {contextMenu}
        {editing ? (
          <div className="p-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('math.placeholder')}
              spellCheck={false}
              rows={Math.max(2, draft.split('\n').length + 1)}
              className="w-full font-mono text-sm p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none resize-y"
              onKeyDown={onKeyDown}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={cancel}
                className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                {t('editor.cancel')}
              </button>
              <button
                type="button"
                onClick={apply}
                className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
              >
                {t('editor.apply')}
              </button>
            </div>
          </div>
        ) : error ? (
          <div className="p-3 cursor-pointer" onClick={() => setEditing(true)}>
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              {t('math.error')}
            </div>
            <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{latex}</pre>
          </div>
        ) : !latex.trim() ? (
          <div
            className="p-4 text-center text-sm text-gray-400 dark:text-gray-500 cursor-pointer"
            onClick={() => setEditing(true)}
          >
            {t('math.empty')}
          </div>
        ) : (
          <div
            className="p-2 flex justify-center overflow-x-auto cursor-pointer text-lg"
            onDoubleClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </NodeViewWrapper>
    );
  }

  // Inline
  return (
    <NodeViewWrapper
      as="span"
      className={`iur-math-inline rounded ${ring}`}
      data-math-inline
      onContextMenu={openMenu}
    >
      {contextMenu}
      {editing ? (
        <span className="inline-flex items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('math.placeholder')}
            spellCheck={false}
            size={Math.max(8, draft.length + 2)}
            className="font-mono text-sm px-1.5 py-0.5 rounded border border-primary-400 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none"
            onKeyDown={onKeyDown}
            onBlur={apply}
          />
        </span>
      ) : error ? (
        <span
          className="text-amber-700 dark:text-amber-400 font-mono text-sm cursor-pointer border-b border-dotted border-amber-500"
          title={error}
          onClick={() => setEditing(true)}
        >
          ${latex}$
        </span>
      ) : !latex.trim() ? (
        <span
          className="text-gray-400 dark:text-gray-500 text-sm cursor-pointer italic"
          onClick={() => setEditing(true)}
        >
          {t('math.empty')}
        </span>
      ) : (
        <span
          className="cursor-pointer"
          onClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </NodeViewWrapper>
  );
};
