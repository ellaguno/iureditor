import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { X } from 'lucide-react';
import { highlightCode, splitHighlightedLines } from '../lib/highlight';
import { t } from '../lib/i18n';
import {
  findMatches,
  injectSearchMarks,
  replaceAllMatches,
  replaceMatch,
} from '../lib/sourceSearch';
import { SearchBarUI, type SearchDriver } from './SearchBar';

export interface SourceViewHandle {
  /** Abre la barra de búsqueda (Ctrl+F). */
  openSearch: () => void;
  /** Abre la barrita "Ir a línea" (Ctrl+L). */
  openGoToLine: () => void;
  /** Lleva el caret al inicio de la línea dada (1-based) y la centra. */
  goToLine: (line: number) => void;
  /** Coloca el caret en un offset absoluto del texto y centra su línea
   *  (restauración de sesión). */
  setCaret: (offset: number) => void;
}

// Vista de código fuente: el markdown crudo (o un archivo no-markdown) en un
// editor con resaltado de sintaxis. Se implementa con el patrón overlay: un
// <textarea> transparente encima de un <pre> resaltado, sincronizados en
// scroll y tipografía. Los cambios se aplican al editor WYSIWYG al volver,
// guardar o exportar (ver App.tsx).
export const SourceView = forwardRef<
  SourceViewHandle,
  {
    value: string;
    onChange: (markdown: string) => void;
    /** Línea (1-based) y offset absoluto del caret, para la barra de estado
     *  y la memoria de posición por archivo. */
    onCursorLine?: (line: number, offset?: number) => void;
    spellcheck: boolean;
    /** Lenguaje de resaltado (null = sin resaltar). */
    language?: string | null;
    /** Mostrar números de línea en el margen izquierdo. */
    lineNumbers?: boolean;
  }
>(({ value, onChange, onCursorLine, spellcheck, language = 'markdown', lineNumbers = false }, ref) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [showGoTo, setShowGoTo] = useState(false);
  const [goToValue, setGoToValue] = useState('');
  const goToInputRef = useRef<HTMLInputElement>(null);
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [index, setIndex] = useState(0);
  // Selección a restaurar tras un reemplazo (el value lo controla el padre,
  // así que el caret se repone cuando vuelve ya actualizado).
  const pendingCaret = useRef<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Caret en un offset dado y scroll para centrar su línea. Con números de
  // línea activos el span de la línea da la posición exacta (incluye el
  // wrap); sin ellos se aproxima por altura de línea.
  const caretToOffset = useCallback((offset: number, line: number) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(offset, offset);
    const el = preRef.current?.querySelector<HTMLElement>(`.iur-line[data-ln="${line}"]`);
    if (el) {
      ta.scrollTop = Math.max(0, el.offsetTop - ta.clientHeight / 2);
    } else {
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2);
    }
    syncScroll();
    onCursorLine?.(line, offset);
  }, [onCursorLine]);

  const goToLine = useCallback((line: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    const target = Math.min(Math.max(1, Math.floor(line)), lines.length);
    let offset = 0;
    for (let i = 0; i < target - 1; i++) offset += lines[i].length + 1;
    caretToOffset(offset, target);
  }, [caretToOffset]);

  const setCaret = useCallback((offset: number) => {
    const ta = taRef.current;
    if (!ta) return;
    const clamped = Math.max(0, Math.min(offset, ta.value.length));
    let line = 1;
    for (let i = 0; i < clamped; i++) if (ta.value.charCodeAt(i) === 10) line++;
    caretToOffset(clamped, line);
  }, [caretToOffset]);

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      // Si ya está abierta, Ctrl+F devuelve el foco al campo (como el
      // navegador): el efecto de montaje no se repite, hay que hacerlo aquí.
      if (showSearch) searchInputRef.current?.select();
      setShowSearch(true);
    },
    openGoToLine: () => {
      if (showGoTo) goToInputRef.current?.select();
      setShowGoTo(true);
    },
    goToLine,
    setCaret,
  }));

  const matches = useMemo(
    () => (showSearch ? findMatches(value, term, caseSensitive) : []),
    [showSearch, value, term, caseSensitive]
  );

  // Al cambiar el texto o el término, el índice puede quedar fuera de rango.
  const safeIndex = matches.length ? Math.min(index, matches.length - 1) : 0;

  // Aquí la línea sí es la del archivo: basta contar saltos hasta el caret.
  const reportLine = () => {
    const ta = taRef.current;
    if (!ta || !onCursorLine) return;
    let line = 1;
    const end = ta.selectionStart;
    for (let i = 0; i < end; i++) if (ta.value.charCodeAt(i) === 10) line++;
    onCursorLine(line, end);
  };

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Lleva la coincidencia activa al centro. Se mueve el textarea (el scroller
  // que maneja el usuario) y el <pre> se sincroniza detrás.
  const scrollToCurrent = useCallback(() => {
    const pre = preRef.current;
    const ta = taRef.current;
    if (!pre || !ta) return;
    const hit = pre.querySelector('.iur-search-current');
    if (!hit) return;
    const top = hit.getBoundingClientRect().top - pre.getBoundingClientRect().top;
    const target = pre.scrollTop + top - pre.clientHeight / 2;
    ta.scrollTop = Math.max(0, target);
    syncScroll();
  }, []);

  // El resaltado se inyecta tras pintar el HTML, de ahí el efecto.
  useEffect(() => {
    if (showSearch && matches.length) scrollToCurrent();
  }, [showSearch, matches, safeIndex, scrollToCurrent]);

  useEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const ta = taRef.current;
    if (!ta) return;
    ta.setSelectionRange(caret, caret);
  }, [value]);

  const driver: SearchDriver = {
    setQuery: (nextTerm, nextCase) => {
      setTerm(nextTerm);
      setCaseSensitive(nextCase);
      setIndex(0);
    },
    next: () => setIndex((i) => (matches.length ? (i + 1) % matches.length : 0)),
    prev: () =>
      setIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0)),
    replaceOne: (replacement) => {
      const hit = matches[safeIndex];
      if (!hit) return;
      pendingCaret.current = hit.start + replacement.length;
      onChange(replaceMatch(value, hit, replacement));
    },
    replaceAll: (replacement) => {
      if (!matches.length) return;
      onChange(replaceAllMatches(value, matches, replacement));
      setIndex(0);
    },
    clear: () => {
      setTerm('');
      setIndex(0);
    },
  };

  const marked = (() => {
    const html = highlightCode(value, language);
    return showSearch ? injectSearchMarks(html, matches, safeIndex) : html;
  })();
  // Con números de línea, cada línea lógica se envuelve en un bloque con su
  // número en un ::before absoluto dentro del hueco (--iur-gutter); el
  // textarea recibe el mismo hueco como padding, así ambas capas parten del
  // mismo x y las líneas envueltas quedan sangradas bajo el número.
  const lines = lineNumbers ? splitHighlightedLines(marked) : null;
  const digits = lines ? Math.max(2, String(lines.length).length) : 0;
  const gutter = `${digits + 2}ch`;
  const html = lines
    ? lines
        .map((line, idx) => `<span class="iur-line" data-ln="${idx + 1}">${line}</span>`)
        .join('')
    : // El '\n' final conserva la altura de la última línea al terminar en salto.
      marked + '\n';
  // Tipografía/espaciado IDÉNTICOS en ambas capas para que el texto alinee.
  const shared = 'm-0 border-0 p-4 text-sm iur-mono-block whitespace-pre-wrap break-words';

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
      {showGoTo && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 no-select">
          <input
            ref={goToInputRef}
            autoFocus
            type="number"
            min={1}
            value={goToValue}
            onChange={(e) => setGoToValue(e.target.value)}
            placeholder={t('goto.placeholder')}
            className="px-2.5 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:outline-none w-36"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const n = parseInt(goToValue, 10);
                if (Number.isFinite(n)) {
                  setShowGoTo(false);
                  goToLine(n);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setShowGoTo(false);
                taRef.current?.focus();
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              setShowGoTo(false);
              taRef.current?.focus();
            }}
            className="p-1.5 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            title="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {showSearch && (
        <SearchBarUI
          inputRef={searchInputRef}
          driver={driver}
          total={matches.length}
          current={matches.length ? safeIndex + 1 : 0}
          onClose={() => {
            setShowSearch(false);
            taRef.current?.focus();
          }}
        />
      )}
      <div
        className={`iur-source relative flex-1 w-full overflow-hidden${lines ? ' iur-lines' : ''}`}
        style={lines ? ({ '--iur-gutter': gutter } as CSSProperties) : undefined}
      >
        <pre
          ref={preRef}
          aria-hidden="true"
          className={`${shared} absolute inset-0 overflow-auto pointer-events-none`}
        >
          <code className="hljs bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        <textarea
          ref={taRef}
          autoFocus
          value={value}
          spellCheck={spellcheck && language === 'markdown'}
          onChange={(e) => {
            onChange(e.target.value);
            reportLine();
          }}
          onSelect={reportLine}
          onScroll={syncScroll}
          className={`${shared} absolute inset-0 w-full h-full resize-none overflow-auto bg-transparent text-transparent focus:outline-none`}
          style={{
            WebkitTextFillColor: 'transparent',
            caretColor: '#f3f4f6',
            ...(lines ? { paddingLeft: `calc(1rem + ${gutter})` } : null),
          }}
        />
      </div>
    </div>
  );
});

SourceView.displayName = 'SourceView';
