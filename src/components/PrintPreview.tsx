import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Printer, Settings2 } from 'lucide-react';
import { previewChannel } from '../lib/exportPdf';
import type { PreviewPayload } from '../lib/exportPdf';
import '../styles/print.css';

// Vista previa de PDF con paginación real (paged.js): hojas A4/Carta con
// márgenes configurables, encabezado con datos del front matter y pie con
// "Página X de Y". Los navegadores no soportan los margin boxes de @page
// (counter(page) en @bottom-center); paged.js los polyfillea paginando el
// documento en cajas .pagedjs_page antes de imprimir.

type Paper = 'A4' | 'letter';
type Margin = 'estrecho' | 'normal' | 'amplio';
type Font = 'sans' | 'serif';
type FontSize = '11pt' | '12pt';
type LineHeight = '1.15' | '1.5' | '2';

interface PdfOptions {
  paper: Paper;
  margin: Margin;
  font: Font;
  fontSize: FontSize;
  lineHeight: LineHeight;
  showHeader: boolean;
  headerOnFirst: boolean;
  headerLeft: string;
  headerRight: string;
  showPageNumbers: boolean;
}

const FONT_STACK: Record<Font, string> = {
  sans: "-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Times New Roman', Times, Georgia, serif",
};

const MARGIN_CM: Record<Margin, string> = {
  estrecho: '1.3cm',
  normal: '2cm',
  amplio: '3cm',
};

// Sólo las preferencias de disposición se recuerdan entre documentos; los
// textos del encabezado son del documento (vienen del front matter).
const LAYOUT_KEY = 'iur-pdf-layout';

interface LayoutPrefs {
  paper: Paper;
  margin: Margin;
  font: Font;
  fontSize: FontSize;
  lineHeight: LineHeight;
  showHeader: boolean;
  headerOnFirst: boolean;
  showPageNumbers: boolean;
}

const loadLayoutPrefs = (): LayoutPrefs => {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return { ...DEFAULT_LAYOUT, ...(JSON.parse(raw) as Partial<LayoutPrefs>) };
  } catch {
    /* preferencias corruptas: usa defaults */
  }
  return DEFAULT_LAYOUT;
};

const DEFAULT_LAYOUT: LayoutPrefs = {
  paper: 'letter',
  margin: 'normal',
  font: 'serif',
  fontSize: '12pt',
  lineHeight: '1.5',
  showHeader: true,
  headerOnFirst: false,
  showPageNumbers: true,
};

const cssString = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** CSS @page para paged.js según las opciones elegidas. */
const buildPageCss = (opts: PdfOptions): string => {
  const headerBox = (content: string) =>
    `content: "${cssString(content)}"; font-size: 9pt; color: #6b7280; font-family: inherit;`;
  let css = `@page { size: ${opts.paper}; margin: ${MARGIN_CM[opts.margin]}; `;
  if (opts.showHeader && opts.headerLeft.trim()) {
    css += `@top-left { ${headerBox(opts.headerLeft.trim())} } `;
  }
  if (opts.showHeader && opts.headerRight.trim()) {
    css += `@top-right { ${headerBox(opts.headerRight.trim())} } `;
  }
  if (opts.showPageNumbers) {
    // Sólo crea el margin box (nbsp); el texto "Página X de Y" se escribe
    // como texto literal tras paginar — counter(pages) se evalúa bien en
    // pantalla pero WebKit lo pierde al imprimir ("Página 1 de 0").
    css += '@bottom-center { content: "\\00a0"; font-size: 9pt; color: #6b7280; } ';
  }
  css += '}\n';
  // Mata el contenido CSS del box inferior: el texto va como nodo de texto.
  css +=
    '.pagedjs_margin-bottom-center > .pagedjs_margin-content::after { content: "" !important; }\n';
  if (opts.showHeader && !opts.headerOnFirst) {
    css +=
      '@page:first { @top-left { content: none } @top-right { content: none } }\n';
  }
  // Tipografía del cuerpo (paged.js re-inyecta también las reglas no-@page).
  css += `.print-content { font-family: ${FONT_STACK[opts.font]}; font-size: ${opts.fontSize}; line-height: ${opts.lineHeight}; }\n`;
  return css;
};

const OptionRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
    <span className="w-36 shrink-0 text-right text-gray-500 dark:text-gray-400">{label}</span>
    {children}
  </label>
);

export const PrintPreview = () => {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [pageCount, setPageCount] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [options, setOptions] = useState<PdfOptions>(() => ({
    ...loadLayoutPrefs(),
    headerLeft: '',
    headerRight: '',
  }));
  const containerRef = useRef<HTMLDivElement>(null);
  const renderSeq = useRef(0);

  useEffect(() => {
    const unlistenPromise = previewChannel.onContent((p) => {
      setPayload(p);
      document.title = `Vista previa — ${p.title}`;
      // Prellenado del encabezado desde el front matter (o el nombre del doc).
      const left = p.fields.titulo || p.fields.title || p.title;
      const right = p.fields.expediente ? `Exp. ${p.fields.expediente}` : '';
      setOptions((prev) => ({ ...prev, headerLeft: left, headerRight: right }));
    });
    void previewChannel.announceReady();
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Preferencias de disposición persistentes (no los textos del documento).
  useEffect(() => {
    const { headerLeft: _l, headerRight: _r, ...layout } = options;
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [options]);

  // Re-paginar (debounced) cuando cambian contenido u opciones.
  useEffect(() => {
    if (!payload || !containerRef.current) return;
    const seq = ++renderSeq.current;
    setRendering(true);
    const timer = setTimeout(() => {
      void (async () => {
        const { Previewer } = await import('pagedjs');
        if (seq !== renderSeq.current || !containerRef.current) return;
        containerRef.current.innerHTML = '';
        const cssUrl = URL.createObjectURL(
          new Blob([buildPageCss(options)], { type: 'text/css' })
        );
        try {
          const previewer = new Previewer();
          const result = await previewer.preview(
            `<div class="markdown-content print-content">${payload.html}</div>`,
            [cssUrl],
            containerRef.current
          );
          if (seq === renderSeq.current) {
            setPageCount(result?.total ?? 0);
            // Numeración como texto literal (ver comentario en buildPageCss).
            if (options.showPageNumbers && containerRef.current) {
              const pages = containerRef.current.querySelectorAll('.pagedjs_page');
              pages.forEach((page, i) => {
                const box = page.querySelector(
                  '.pagedjs_margin-bottom-center .pagedjs_margin-content'
                );
                if (box) box.textContent = `Página ${i + 1} de ${pages.length}`;
              });
            }
          }
        } catch (err) {
          console.error('paged.js falló al paginar:', err);
        } finally {
          URL.revokeObjectURL(cssUrl);
          if (seq === renderSeq.current) setRendering(false);
        }
      })();
    }, 350);
    return () => clearTimeout(timer);
  }, [payload, options]);

  const handlePrint = useCallback(async () => {
    try {
      window.print();
    } catch {
      /* sigue el fallback */
    }
    // Fallback nativo (WKWebView en macOS es poco fiable con window.print()).
    if (navigator.userAgent.includes('Mac')) {
      try {
        await invoke('print_webview');
      } catch (err) {
        console.error('print_webview fallback falló:', err);
      }
    }
  }, []);

  const set = <K extends keyof PdfOptions>(key: K, value: PdfOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));

  if (!payload) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const selectCls =
    'px-2 py-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100';

  return (
    <div className="print-preview-root min-h-full bg-gray-100 dark:bg-gray-950">
      {/* Barra de acciones — oculta al imprimir */}
      <div className="print-hide sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 no-select">
        <div className="px-4 py-2 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
            {rendering
              ? 'Paginando…'
              : `${pageCount} página${pageCount === 1 ? '' : 's'} — elige «Guardar como PDF» en el diálogo de impresión`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowOptions((v) => !v)}
              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 border ${
                showOptions
                  ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Opciones
            </button>
            <button
              onClick={() => void handlePrint()}
              className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Imprimir / Guardar PDF
            </button>
          </div>
        </div>

        {showOptions && (
          <div className="px-4 pb-3 pt-1 flex flex-col gap-2 border-t border-gray-100 dark:border-gray-700">
            <div className="flex flex-wrap gap-x-8 gap-y-2 pt-2">
              <OptionRow label="Papel">
                <select
                  value={options.paper}
                  onChange={(e) => set('paper', e.target.value as Paper)}
                  className={selectCls}
                >
                  <option value="letter">Carta</option>
                  <option value="A4">A4</option>
                </select>
              </OptionRow>
              <OptionRow label="Márgenes">
                <select
                  value={options.margin}
                  onChange={(e) => set('margin', e.target.value as Margin)}
                  className={selectCls}
                >
                  <option value="estrecho">Estrechos (1.3 cm)</option>
                  <option value="normal">Normales (2 cm)</option>
                  <option value="amplio">Amplios (3 cm)</option>
                </select>
              </OptionRow>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={options.showPageNumbers}
                  onChange={(e) => set('showPageNumbers', e.target.checked)}
                />
                Numerar páginas
              </label>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <OptionRow label="Fuente">
                <select
                  value={options.font}
                  onChange={(e) => set('font', e.target.value as Font)}
                  className={selectCls}
                >
                  <option value="serif">Serif (Times)</option>
                  <option value="sans">Sans (moderna)</option>
                </select>
              </OptionRow>
              <OptionRow label="Tamaño">
                <select
                  value={options.fontSize}
                  onChange={(e) => set('fontSize', e.target.value as FontSize)}
                  className={selectCls}
                >
                  <option value="11pt">11 pt</option>
                  <option value="12pt">12 pt</option>
                </select>
              </OptionRow>
              <OptionRow label="Interlineado">
                <select
                  value={options.lineHeight}
                  onChange={(e) => set('lineHeight', e.target.value as LineHeight)}
                  className={selectCls}
                >
                  <option value="1.15">Sencillo (1.15)</option>
                  <option value="1.5">1.5 líneas</option>
                  <option value="2">Doble</option>
                </select>
              </OptionRow>
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={options.showHeader}
                  onChange={(e) => set('showHeader', e.target.checked)}
                />
                Encabezado
              </label>
              {options.showHeader && (
                <>
                  <OptionRow label="Izquierda">
                    <input
                      value={options.headerLeft}
                      onChange={(e) => set('headerLeft', e.target.value)}
                      className={`${selectCls} w-64`}
                      placeholder="Título del documento"
                    />
                  </OptionRow>
                  <OptionRow label="Derecha">
                    <input
                      value={options.headerRight}
                      onChange={(e) => set('headerRight', e.target.value)}
                      className={`${selectCls} w-48`}
                      placeholder="Exp. 123/2026"
                    />
                  </OptionRow>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={options.headerOnFirst}
                      onChange={(e) => set('headerOnFirst', e.target.checked)}
                    />
                    También en la primera página
                  </label>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Hojas paginadas por paged.js */}
      <div ref={containerRef} className="paged-preview" />
    </div>
  );
};
