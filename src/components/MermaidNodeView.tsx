import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Download,
  Image as ImageIcon,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { renderMermaidSvg } from '../lib/mermaid';
import { saveSvg, savePng } from '../lib/diagramExport';
import { t } from '../lib/i18n';

// Andamiaje inicial por tipo de diagrama (el usuario lo edita después).
const TEMPLATES = [
  {
    labelKey: 'mermaid.tpl.flowchart',
    code: 'flowchart TD\n    A[Inicio] --> B{Decisión}\n    B -->|Sí| C[Acción]\n    B -->|No| D[Fin]',
  },
  {
    labelKey: 'mermaid.tpl.sequence',
    code: 'sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Solicitud\n    B-->>A: Respuesta',
  },
  {
    labelKey: 'mermaid.tpl.class',
    code: 'classDiagram\n    class Animal {\n      +String nombre\n      +comer()\n    }\n    Animal <|-- Perro',
  },
  {
    labelKey: 'mermaid.tpl.state',
    code: 'stateDiagram-v2\n    [*] --> Inactivo\n    Inactivo --> Activo: iniciar\n    Activo --> [*]: terminar',
  },
  {
    labelKey: 'mermaid.tpl.er',
    code: 'erDiagram\n    CLIENTE ||--o{ PEDIDO : realiza\n    PEDIDO ||--|{ LINEA : contiene',
  },
  {
    labelKey: 'mermaid.tpl.gantt',
    code: 'gantt\n    title Plan\n    dateFormat YYYY-MM-DD\n    section Fase 1\n    Tarea A :a1, 2024-01-01, 7d\n    Tarea B :after a1, 5d',
  },
  {
    labelKey: 'mermaid.tpl.pie',
    code: 'pie title Distribución\n    "A" : 40\n    "B" : 35\n    "C" : 25',
  },
] as const;

// Limpia los nodos huérfanos que mermaid deja en el <body> cuando falla render.
const cleanupMermaidOrphans = (keep?: HTMLElement | null) => {
  document
    .querySelectorAll('body > div[id^="diur-mermaid-"], body > [id^="iur-mermaid-"]')
    .forEach((n) => {
      if (!keep?.contains(n)) n.remove();
    });
};

// NodeView de diagramas mermaid: render en vivo dentro del WYSIWYG. Al editar
// se abre un panel con código a la izquierda y vista previa en vivo a la
// derecha, más plantillas por tipo de diagrama. Export SVG/PNG por diagrama.
export const MermaidNodeView = ({ node, updateAttributes, selected }: NodeViewProps) => {
  const code: string = node.attrs.code || '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  // Vista previa en vivo del borrador (debounced) mientras se edita.
  const [previewSvg, setPreviewSvg] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Render del diagrama ya guardado (vista no-edición).
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
        cleanupMermaidOrphans(containerRef.current);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Vista previa en vivo del borrador, con debounce para no renderizar en cada
  // tecla.
  useEffect(() => {
    if (!editing) return;
    if (!draft.trim()) {
      setPreviewSvg('');
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      renderMermaidSvg(draft)
        .then((rendered) => {
          if (cancelled) return;
          setPreviewSvg(rendered);
          setPreviewError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setPreviewSvg('');
          setPreviewError(err instanceof Error ? err.message : String(err));
          cleanupMermaidOrphans(previewRef.current);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [draft, editing]);

  useEffect(() => {
    if (editing) {
      setDraft(code);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editing, code]);

  // Cierra el desplegable de plantillas al hacer clic fuera.
  useEffect(() => {
    if (!tplOpen) return;
    const close = () => setTplOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [tplOpen]);

  const apply = () => {
    updateAttributes({ code: draft });
    setEditing(false);
  };

  const insertTemplate = (tplCode: string) => {
    setDraft((d) => (d.trim() ? `${d.replace(/\n*$/, '')}\n\n${tplCode}` : tplCode));
    setTplOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') setEditing(false);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) apply();
    // Tab inserta dos espacios en vez de cambiar el foco.
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = ta;
      const next = `${draft.slice(0, s)}  ${draft.slice(en)}`;
      setDraft(next);
      setTimeout(() => ta.setSelectionRange(s + 2, s + 2), 0);
    }
    e.stopPropagation();
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
      {/* Botones hover (sólo en la vista renderizada) */}
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
          {/* Barra de herramientas: plantillas */}
          <div className="flex items-center justify-between mb-2">
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTplOpen((o) => !o);
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t('mermaid.insertTemplate')}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {tplOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.labelKey}
                      type="button"
                      onClick={() => insertTemplate(tpl.code)}
                      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      {t(tpl.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Split: código | vista previa */}
          <div className="flex flex-col md:flex-row gap-3">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('mermaid.codePlaceholder')}
              spellCheck={false}
              rows={Math.max(6, draft.split('\n').length + 1)}
              className="md:w-1/2 w-full font-mono text-sm p-2 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none resize-y"
              onKeyDown={onEditorKeyDown}
            />
            <div className="md:w-1/2 w-full min-h-[8rem] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 overflow-auto flex items-center justify-center">
              {previewError ? (
                <div className="w-full">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs font-medium mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    {t('mermaid.error')}
                  </div>
                  <pre className="text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">
                    {previewError}
                  </pre>
                </div>
              ) : previewSvg ? (
                <div
                  ref={previewRef}
                  className="w-full flex justify-center"
                  dangerouslySetInnerHTML={{ __html: previewSvg }}
                />
              ) : (
                <span className="text-xs italic text-gray-400 dark:text-gray-500">
                  {t('mermaid.previewEmpty')}
                </span>
              )}
            </div>
          </div>

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
