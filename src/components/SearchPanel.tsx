import { useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { searchInFiles, type CancelToken, type SearchOutcome } from '../lib/fileSearch';
import { t } from '../lib/i18n';

// Vista "Buscar" del panel lateral (Ctrl+Shift+F): busca un término en los
// archivos de la carpeta de trabajo y lista las coincidencias agrupadas por
// archivo. La búsqueda corre al pulsar Enter (recorre disco: no por tecleo).
export const SearchPanel = ({
  workspace,
  onOpenResult,
}: {
  workspace: string | null;
  /** Abre el archivo y salta a la línea de la coincidencia. */
  onOpenResult: (path: string, line: number) => void;
}) => {
  const [term, setTerm] = useState('');
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [searching, setSearching] = useState(false);
  const tokenRef = useRef<CancelToken | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Al desmontar (cambio de vista/carpeta), cancelar la búsqueda en curso.
    return () => {
      if (tokenRef.current) tokenRef.current.cancelled = true;
    };
  }, []);

  const runSearch = async () => {
    const query = term.trim();
    if (!workspace || query.length < 2) return;
    if (tokenRef.current) tokenRef.current.cancelled = true;
    const token: CancelToken = { cancelled: false };
    tokenRef.current = token;
    setSearching(true);
    try {
      const result = await searchInFiles(workspace, query, token);
      if (!token.cancelled) setOutcome(result);
    } catch (err) {
      console.error('Búsqueda en archivos falló:', err);
    } finally {
      if (tokenRef.current === token) setSearching(false);
    }
  };

  if (!workspace) {
    return (
      <div className="p-4 text-xs text-gray-400 dark:text-gray-500">
        {t('fsearch.noWorkspace')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={term}
            spellCheck={false}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void runSearch();
              }
            }}
            placeholder={t('fsearch.placeholder')}
            className="w-full pl-7 pr-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:ring-1 focus:ring-primary-500 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        {searching && (
          <p className="px-3 py-1 text-xs italic text-gray-400 dark:text-gray-500">
            {t('fsearch.searching')}
          </p>
        )}
        {!searching && outcome && outcome.results.length === 0 && (
          <p className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500">
            {t('fsearch.empty')}
          </p>
        )}
        {!searching &&
          outcome?.results.map((file) => (
            <div key={file.path} className="mb-1">
              <div
                className="px-2 py-0.5 flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300"
                title={file.path}
              >
                <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{file.relative}</span>
                <span className="ml-auto shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                  {file.matches.length}
                </span>
              </div>
              {file.matches.map((m) => (
                <button
                  key={`${file.path}:${m.line}`}
                  type="button"
                  onClick={() => onOpenResult(file.path, m.line)}
                  className="w-full pl-7 pr-2 py-0.5 flex items-baseline gap-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <span className="shrink-0 tabular-nums text-gray-400 dark:text-gray-500">
                    {m.line}
                  </span>
                  <span className="truncate text-gray-600 dark:text-gray-400">{m.text}</span>
                </button>
              ))}
            </div>
          ))}
        {!searching && outcome?.truncated && (
          <p className="px-3 py-1 text-[11px] italic text-gray-400 dark:text-gray-500">
            {t('fsearch.truncated')}
          </p>
        )}
      </div>
    </div>
  );
};
