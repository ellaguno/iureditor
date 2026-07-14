import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ChevronDown, ChevronUp, X, CaseSensitive } from 'lucide-react';
import { t } from '../lib/i18n';

// Barra de búsqueda y reemplazo (Ctrl+F). Vive bajo la toolbar.
export const SearchBar = ({ editor, onClose }: { editor: Editor; onClose: () => void }) => {
  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const storage = editor.storage.searchReplace;
  const total = storage.results.length;
  const current = total ? storage.index + 1 : 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      editor.commands.clearSearch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    editor.commands.setSearch(term, caseSensitive);
    if (term) scrollToCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, caseSensitive]);

  const scrollToCurrent = () => {
    const hit = editor.storage.searchReplace.results[editor.storage.searchReplace.index];
    if (!hit) return;
    const el = editor.view.domAtPos(hit.from).node;
    const target = el instanceof Element ? el : el.parentElement;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const next = () => {
    editor.commands.findNext();
    scrollToCurrent();
  };
  const prev = () => {
    editor.commands.findPrev();
    scrollToCurrent();
  };

  const replaceOne = () => {
    editor.commands.replaceCurrent(replacement);
    scrollToCurrent();
  };
  const replaceEverything = () => editor.commands.replaceAll(replacement);

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
