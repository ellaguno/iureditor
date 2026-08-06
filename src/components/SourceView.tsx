import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { highlightCode } from '../lib/highlight';
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
    /** Línea (1-based) donde está el caret, para la barra de estado. */
    onCursorLine?: (line: number) => void;
    spellcheck: boolean;
    /** Lenguaje de resaltado (null = sin resaltar). */
    language?: string | null;
  }
>(({ value, onChange, onCursorLine, spellcheck, language = 'markdown' }, ref) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const [showSearch, setShowSearch] = useState(false);
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [index, setIndex] = useState(0);
  // Selección a restaurar tras un reemplazo (el value lo controla el padre,
  // así que el caret se repone cuando vuelve ya actualizado).
  const pendingCaret = useRef<number | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      // Si ya está abierta, Ctrl+F devuelve el foco al campo (como el
      // navegador): el efecto de montaje no se repite, hay que hacerlo aquí.
      if (showSearch) searchInputRef.current?.select();
      setShowSearch(true);
    },
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
    onCursorLine(line);
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

  // El '\n' final conserva la altura de la última línea al terminar en salto.
  const html = highlightCode(value, language) + '\n';
  const marked = showSearch ? injectSearchMarks(html, matches, safeIndex) : html;
  // Tipografía/espaciado IDÉNTICOS en ambas capas para que el texto alinee.
  const shared = 'm-0 border-0 p-4 text-sm iur-mono-block whitespace-pre-wrap break-words';

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
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
      <div className="iur-source relative flex-1 w-full overflow-hidden">
        <pre
          ref={preRef}
          aria-hidden="true"
          className={`${shared} absolute inset-0 overflow-auto pointer-events-none`}
        >
          <code className="hljs bg-transparent" dangerouslySetInnerHTML={{ __html: marked }} />
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
          style={{ WebkitTextFillColor: 'transparent', caretColor: '#f3f4f6' }}
        />
      </div>
    </div>
  );
});

SourceView.displayName = 'SourceView';
