import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronUp, X, CaseSensitive } from 'lucide-react';
import { t } from '../lib/i18n';

/** Motor de búsqueda que la barra maneja. Lo implementan el editor WYSIWYG
 *  (decoraciones de ProseMirror) y la vista fuente (texto del textarea). */
export interface SearchDriver {
  /** Término o sensibilidad a mayúsculas cambiados. */
  setQuery: (term: string, caseSensitive: boolean) => void;
  next: () => void;
  prev: () => void;
  replaceOne: (replacement: string) => void;
  replaceAll: (replacement: string) => void;
  /** Se llama al cerrar la barra, para limpiar el resaltado. */
  clear: () => void;
}

// Barra de búsqueda y reemplazo (Ctrl+F). Vive bajo la toolbar. Es sólo la
// interfaz: quién busca de verdad es el `driver`.
export const SearchBarUI = ({
  driver,
  total,
  current,
  onClose,
  inputRef: externalInputRef,
}: {
  driver: SearchDriver;
  /** Nº de coincidencias. */
  total: number;
  /** Coincidencia activa, 1-based (0 si no hay). */
  current: number;
  onClose: () => void;
  /** Para que el padre pueda reenfocar el campo (Ctrl+F con la barra abierta). */
  inputRef?: RefObject<HTMLInputElement | null>;
}) => {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const ownInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? ownInputRef;
  // El driver cambia de identidad en cada render del padre; el efecto de
  // limpieza debe usar el último, no el que había al montar.
  const driverRef = useRef(driver);
  driverRef.current = driver;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => driverRef.current.clear();
  }, []);

  useEffect(() => {
    driverRef.current.setQuery(term, caseSensitive);
  }, [term, caseSensitive]);

  const next = () => driver.next();
  const prev = () => driver.prev();
  const replaceOne = () => driver.replaceOne(replacement);
  const replaceEverything = () => driver.replaceAll(replacement);

  const BTN =
    'p-1.5 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40';
  const INPUT =
    'px-2.5 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:outline-none w-52';

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 no-select">
      <input
        ref={inputRef}
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('search.placeholder')}
        className={INPUT}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) prev();
            else next();
          }
          if (e.key === 'Escape') onClose();
        }}
      />
      <span className="text-xs text-gray-500 dark:text-gray-400 min-w-[52px] text-center tabular-nums">
        {term ? `${current}/${total}` : ''}
      </span>
      <button type="button" title={t('search.prev')} onClick={prev} disabled={!total} className={BTN}>
        <ChevronUp className="w-4 h-4" />
      </button>
      <button type="button" title={t('search.next')} onClick={next} disabled={!total} className={BTN}>
        <ChevronDown className="w-4 h-4" />
      </button>
      <button
        type="button"
        title={t('search.caseSensitive')}
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`${BTN} ${caseSensitive ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300' : ''}`}
      >
        <CaseSensitive className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => setShowReplace(!showReplace)}
        className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {t('search.replaceToggle')}
      </button>

      {showReplace && (
        <>
          <input
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={t('search.replaceWith')}
            className={INPUT}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceOne();
              }
              if (e.key === 'Escape') onClose();
            }}
          />
          <button
            type="button"
            onClick={replaceOne}
            disabled={!total}
            className="px-2 py-1 text-xs rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40"
          >
            {t('search.replace')}
          </button>
          <button
            type="button"
            onClick={replaceEverything}
            disabled={!total}
            className="px-2 py-1 text-xs rounded text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 disabled:opacity-40"
          >
            {t('search.replaceAll')}
          </button>
        </>
      )}

      <div className="flex-1" />
      <button type="button" title={t('editor.cancel')} onClick={onClose} className={BTN}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

// Adaptador para el editor WYSIWYG: la búsqueda son decoraciones de
// ProseMirror y el estado vive en editor.storage.searchReplace.
export const SearchBar = ({ editor, onClose }: { editor: Editor; onClose: () => void }) => {
  const storage = editor.storage.searchReplace;
  const total = storage.results.length;

  const scrollToCurrent = () => {
    const hit = editor.storage.searchReplace.results[editor.storage.searchReplace.index];
    if (!hit) return;
    const el = editor.view.domAtPos(hit.from).node;
    const target = el instanceof Element ? el : el.parentElement;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const driver: SearchDriver = {
    setQuery: (term, caseSensitive) => {
      editor.commands.setSearch(term, caseSensitive);
      if (term) scrollToCurrent();
    },
    next: () => {
      editor.commands.findNext();
      scrollToCurrent();
    },
    prev: () => {
      editor.commands.findPrev();
      scrollToCurrent();
    },
    replaceOne: (replacement) => {
      editor.commands.replaceCurrent(replacement);
      scrollToCurrent();
    },
    replaceAll: (replacement) => editor.commands.replaceAll(replacement),
    clear: () => editor.commands.clearSearch(),
  };

  return (
    <SearchBarUI
      driver={driver}
      total={total}
      current={total ? storage.index + 1 : 0}
      onClose={onClose}
    />
  );
};
