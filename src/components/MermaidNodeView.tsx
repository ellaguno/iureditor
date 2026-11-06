import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Download,
  Image as ImageIcon,
  AlertTriangle,
  ChevronDown,
  Sparkles,
  Loader2,
} from 'lucide-react';
import {
  renderMermaidSvg,
  useDarkTheme,
  cleanupMermaidOrphans,
  lightSvgElement,
} from '../lib/mermaid';
import { saveSvg, savePng } from '../lib/diagramExport';
import { assistDiagram } from '../lib/mermaidAssist';
import { t, useLang } from '../lib/i18n';

// Andamiaje inicial por tipo de diagrama (el usuario lo edita después); el
// texto de ejemplo sale en el idioma de la interfaz.
const TEMPLATES = [
  {
    labelKey: 'mermaid.tpl.flowchart',
    codeKey: 'mermaid.code.flowchart',
  },
  {
    labelKey: 'mermaid.tpl.sequence',
    codeKey: 'mermaid.code.sequence',
  },
  {
    labelKey: 'mermaid.tpl.class',
    codeKey: 'mermaid.code.class',
  },
  {
    labelKey: 'mermaid.tpl.state',
    codeKey: 'mermaid.code.state',
  },
  {
    labelKey: 'mermaid.tpl.er',
    codeKey: 'mermaid.code.er',
  },
  {
    labelKey: 'mermaid.tpl.gantt',
    codeKey: 'mermaid.code.gantt',
  },
  {
    labelKey: 'mermaid.tpl.pie',
    codeKey: 'mermaid.code.pie',
  },
  {
    labelKey: 'mermaid.tpl.quadrant',
    codeKey: 'mermaid.code.quadrant',
  },
  {
    labelKey: 'mermaid.tpl.mindmap',
    codeKey: 'mermaid.code.mindmap',
  },
  {
    labelKey: 'mermaid.tpl.timeline',
    codeKey: 'mermaid.code.timeline',
  },
  {
    labelKey: 'mermaid.tpl.journey',
    codeKey: 'mermaid.code.journey',
  },
  {
    labelKey: 'mermaid.tpl.git',
    codeKey: 'mermaid.code.git',
  },
  {
    labelKey: 'mermaid.tpl.xychart',
    codeKey: 'mermaid.code.xychart',
  },
  {
    labelKey: 'mermaid.tpl.sankey',
    codeKey: 'mermaid.code.sankey',
  },
  {
    labelKey: 'mermaid.tpl.kanban',
    codeKey: 'mermaid.code.kanban',
  },
  {
    labelKey: 'mermaid.tpl.block',
    codeKey: 'mermaid.code.block',
  },
  {
    labelKey: 'mermaid.tpl.requirement',
    codeKey: 'mermaid.code.requirement',
  },
  {
    labelKey: 'mermaid.tpl.packet',
    codeKey: 'mermaid.code.packet',
  },
  {
    labelKey: 'mermaid.tpl.radar',
    codeKey: 'mermaid.code.radar',
  },
  {
    labelKey: 'mermaid.tpl.treemap',
    codeKey: 'mermaid.code.treemap',
  },
  {
    labelKey: 'mermaid.tpl.c4',
    codeKey: 'mermaid.code.c4',
  },
] as const;

// NodeView de diagramas mermaid: render en vivo dentro del WYSIWYG. Al editar
// se abre un panel con código a la izquierda y vista previa en vivo a la
// derecha, más plantillas por tipo de diagrama. Export SVG/PNG por diagrama.
export const MermaidNodeView = ({ node, updateAttributes, selected }: NodeViewProps) => {
  useLang();
  const dark = useDarkTheme();
  const code: string = node.attrs.code || '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  // Vista previa en vivo del borrador (debounced) mientras se edita.
  const [previewSvg, setPreviewSvg] = useState('');
  // Código del que sale previewSvg (el debounce lo deja atrás del borrador).
  const [previewCode, setPreviewCode] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  // Un diagrama que ya se editó deja de usar content-visibility:auto (ver
  // tiptap.css): WebKitGTK no repintaba el nodo al cerrar el editor y el
  // diagrama quedaba en blanco hasta salir y volver con el scroll.
  const [touched, setTouched] = useState(false);
  // Última plantilla insertada tal cual: si el borrador sigue igual, elegir
  // otra la sustituye sin preguntar.
  const lastTemplateRef = useRef<string | null>(null);
  // Asistente de IA (Iurefficient): petición en curso, error y el borrador
  // previo a la última generación para poder restaurarlo.
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistText, setAssistText] = useState('');
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistPrev, setAssistPrev] = useState<string | null>(null);
  // Cada petición lleva un número: cancelar o cerrar el editor descarta la
  // respuesta que llegue después.
  const assistReqRef = useRef(0);
  const assistInputRef = useRef<HTMLInputElement>(null);
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
  }, [code, dark]);

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
          setPreviewCode(draft);
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
  }, [draft, editing, dark]);

  useEffect(() => {
    if (editing) {
      setTouched(true);
      setDraft(code);
      lastTemplateRef.current = null;
      assistReqRef.current++;
      setAssistBusy(false);
      setAssistError(null);
      setAssistPrev(null);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editing, code]);

  // Al abrir el asistente, el foco va a su campo (tras pintarse).
  useEffect(() => {
    if (assistOpen) assistInputRef.current?.focus();
  }, [assistOpen]);

  // Cierra el desplegable de plantillas al hacer clic fuera.
  useEffect(() => {
    if (!tplOpen) return;
    const close = () => setTplOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [tplOpen]);

  const apply = () => {
    // Si la vista previa ya corresponde al borrador se muestra de inmediato:
    // si no, el contenedor quedaba vacío hasta que terminara el render nuevo.
    if (previewSvg && previewCode === draft) {
      setSvg(previewSvg);
      setError(null);
    }
    updateAttributes({ code: draft });
    setEditing(false);
  };

  const insertTemplate = async (tplCode: string) => {
    setTplOpen(false);
    // Un bloque admite un solo diagrama: la plantilla sustituye al borrador.
    // Si éste ya tiene cambios del usuario, se pide confirmación antes.
    const pristine = !draft.trim() || draft === code || draft === lastTemplateRef.current;
    if (!pristine) {
      const { ask } = await import('@tauri-apps/plugin-dialog');
      const ok = await ask(t('mermaid.replaceWithTemplate'), {
        kind: 'warning',
        okLabel: t('mermaid.replace'),
        cancelLabel: t('editor.cancel'),
      });
      if (!ok) return;
    }
    lastTemplateRef.current = tplCode;
    setDraft(tplCode);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const runAssist = async () => {
    const request = assistText.trim();
    if (!request || assistBusy) return;
    const req = ++assistReqRef.current;
    const before = draft;
    setAssistBusy(true);
    setAssistError(null);
    try {
      const result = await assistDiagram(request, before);
      if (req !== assistReqRef.current) return;
      if (!result.code) {
        setAssistError(t('mermaid.assistEmpty'));
        return;
      }
      setAssistPrev(before);
      lastTemplateRef.current = null;
      setDraft(result.code);
      setAssistText('');
      if (result.error) setAssistError(t('mermaid.assistInvalid'));
    } catch (err) {
      if (req !== assistReqRef.current) return;
      setAssistError(err instanceof Error ? err.message : String(err));
    } finally {
      if (req === assistReqRef.current) setAssistBusy(false);
    }
  };

  const cancelAssist = () => {
    assistReqRef.current++;
    setAssistBusy(false);
  };

  const onAssistKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runAssist();
    }
    if (e.key === 'Escape') {
      if (assistBusy) cancelAssist();
      else setAssistOpen(false);
      textareaRef.current?.focus();
    }
    e.stopPropagation();
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

  // En tema claro basta el SVG en pantalla; en oscuro se re-renderiza claro.
  const getExportSvg = async (): Promise<SVGElement | null> =>
    dark ? lightSvgElement(code) : (containerRef.current?.querySelector('svg') ?? null);

  return (
    <NodeViewWrapper
      className={`iur-mermaid-node ${touched ? 'iur-cv-off ' : ''}group relative my-4 rounded-lg border ${
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
                  void getExportSvg().then((el) => {
                    if (el) return saveSvg(el, `${t('mermaid.fileName')}.svg`);
                  });
                }}
                className="p-1.5 rounded bg-white/90 dark:bg-gray-700/90 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t('mermaid.exportPng')}
                onClick={() => {
                  void getExportSvg().then((el) => {
                    if (el) return savePng(el, `${t('mermaid.fileName')}.png`);
                  });
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
        <div className="iur-mermaid-edit p-3">
          {/* Barra de herramientas: plantillas y asistente */}
          <div className="flex items-center gap-2 mb-2">
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
                <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] max-h-80 overflow-y-auto py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
                  {TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.labelKey}
                      type="button"
                      onClick={() => void insertTemplate(t(tpl.codeKey))}
                      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      {t(tpl.labelKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              title={t('mermaid.assistTitle')}
              onClick={() => setAssistOpen((o) => !o)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded border ${
                assistOpen
                  ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-600 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {t('mermaid.assist')}
            </button>
          </div>

          {assistOpen && (
            <div className="mb-2">
              <div className="flex gap-2">
                <input
                  ref={assistInputRef}
                  value={assistText}
                  onChange={(e) => setAssistText(e.target.value)}
                  onKeyDown={onAssistKeyDown}
                  placeholder={t('mermaid.assistPlaceholder')}
                  disabled={assistBusy}
                  className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:outline-none disabled:opacity-60"
                />
                {assistBusy ? (
                  <button
                    type="button"
                    onClick={cancelAssist}
                    className="flex items-center gap-1 px-3 py-1 text-sm rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {t('editor.cancel')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void runAssist()}
                    disabled={!assistText.trim()}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50"
                  >
                    {t('mermaid.assistGenerate')}
                  </button>
                )}
              </div>
              <div className="flex items-start justify-between gap-2 mt-1 text-xs">
                <span className={assistError ? 'text-amber-700 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500'}>
                  {assistBusy ? t('mermaid.assistWorking') : (assistError ?? t('mermaid.assistPrivacy'))}
                </span>
                {assistPrev !== null && !assistBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(assistPrev);
                      setAssistPrev(null);
                      setAssistError(null);
                    }}
                    className="shrink-0 text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {t('mermaid.assistUndo')}
                  </button>
                )}
              </div>
            </div>
          )}

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
