import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Pencil, Download, Image as ImageIcon, AlertTriangle } from 'lucide-react';
import { renderMermaidSvg } from '../lib/mermaid';
import { saveSvg, savePng } from '../lib/diagramExport';
import { t } from '../lib/i18n';

// NodeView de diagramas mermaid: render en vivo dentro del WYSIWYG, clic o
// botón "Editar" para modificar el código, export SVG/PNG por diagrama.
export const MermaidNodeView = ({ node, updateAttributes, selected }: NodeViewProps) => {
  const code: string = node.attrs.code || '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (!code.trim()) {
      setSvg('');
      setError(null);
      return;
    }
    renderMermaidSvg(code)
      .then((rendered) => {
        if (cancelled) return;
        setSvg(rendered);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSvg('');
        setError(err instanceof Error ? err.message : String(err));
        // mermaid deja nodos de error huérfanos en el body al fallar render
        document.querySelectorAll('body > div[id^="diur-mermaid-"], body > [id^="iur-mermaid-"]').forEach((n) => {
          if (!containerRef.current?.contains(n)) n.remove();
        });
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (editing) {
      setDraft(code);
      // focus tras montar el textarea
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editing, code]);

  const apply = () => {
    updateAttributes({ code: draft });
    setEditing(false);
  };

  const getSvgElement = (): SVGElement | null =>
    containerRef.current?.querySelector('svg') ?? null;

  return (
    <NodeViewWrapper
      className={`iur-mermaid-node group relative my-4 rounded-lg border ${
        selected
          ? 'border-primary-400 ring-2 ring-primary-200 dark:ring-primary-800'
          : 'border-gray-200 dark:border-gray-700'
      } bg-white dark:bg-gray-800`}
      data-type="mermaid"
    >
      {/* Botones hover */}
      {!editing && (
        <div className="absolute top-2 right-2 z-10 hidden group-hover:flex gap-1">
          <button
            type="button"
            title={t('mermaid.edit')}
            onClick={() => setEditing(true)}
            className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {svg && (
            <>
              <button
                type="button"
                title={t('mermaid.exportSvg')}
                onClick={() => {
                  const el = getSvgElement();
                  if (el) void saveSvg(el, 'diagrama.svg');
                }}
                className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t('mermaid.exportPng')}
                onClick={() => {
                  const el = getSvgElement();
                  if (el) void savePng(el, 'diagrama.png');
                }}
                className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {editing ? (
        <div className="p-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('mermaid.codePlaceholder')}
            spellCheck={false}
            rows={Math.max(4, draft.split('\n').length + 1)}
            className="w-full font-mono text-sm p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none resize-y"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
              e.stopPropagation();
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
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
        <div
          className="p-3 cursor-pointer"
          onClick={() => setEditing(true)}
          title={t('mermaid.edit')}
        >
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium mb-2">
            <AlertTriangle className="w-4 h-4" />
            {t('mermaid.error')}
          </div>
          <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap mb-2">{error}</pre>
          <pre className="text-xs font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 p-2 rounded">
            {code}
          </pre>
        </div>
      ) : !code.trim() ? (
        <div
          className="p-6 text-center text-sm text-gray-400 dark:text-gray-500 cursor-pointer"
          onClick={() => setEditing(true)}
        >
          {t('mermaid.empty')}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="iur-mermaid-svg p-3 flex justify-center overflow-x-auto cursor-pointer"
          onDoubleClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  );
};
