import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, FilePlus, Library } from 'lucide-react';
import { useVault, vault } from '../lib/vault';
import { wikiDisplay } from '../lib/wikilinks';
import type { LinkOccurrence } from '../lib/wikilinks';
import { basename } from '../lib/fileio';
import { t, tn } from '../lib/i18n';

type Section = 'backlinks' | 'outgoing' | 'unlinked';

// Vista «Enlaces» del panel lateral: qué notas apuntan a la activa
// (entrantes), a cuáles apunta ella (salientes) y cuáles la mencionan sin
// enlazarla. Se calcula sobre el índice de la bóveda, que refleja lo
// guardado en disco.
export const LinksPanel = ({
  activePath,
  onOpenBacklink,
  onOpenMention,
  onOpenOutgoing,
}: {
  activePath: string | null;
  /** Abre `source` y muestra su enlace a la nota activa. */
  onOpenBacklink: (source: string) => void;
  /** Abre `source` y muestra la primera mención de la nota activa. */
  onOpenMention: (source: string) => void;
  /** Sigue un enlace saliente (crea la nota si no existe). */
  onOpenOutgoing: (occ: LinkOccurrence) => void;
}) => {
  const snap = useVault();
  const [collapsed, setCollapsed] = useState<Set<Section>>(new Set());

  const data = useMemo(() => {
    const index = vault.index;
    if (!index || !activePath || !index.contains(activePath)) return null;
    return {
      backlinks: index.backlinks(activePath),
      outgoing: index.outgoing(activePath),
      unlinked: index.unlinkedMentions(activePath),
    };
    // snap.version cambia con cada modificación del índice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath, snap.version]);

  const toggle = (s: Section) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const header = (s: Section, label: string, count: number) => (
    <button
      type="button"
      onClick={() => toggle(s)}
      className="w-full px-2 py-1 flex items-center gap-1 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
    >
      {collapsed.has(s) ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      <span className="truncate">{label}</span>
      <span className="ml-auto tabular-nums normal-case">{count}</span>
    </button>
  );

  const none = <p className="px-7 py-0.5 text-xs italic text-gray-400 dark:text-gray-500">{t('links.none')}</p>;

  if (!activePath) {
    return <p className="p-4 text-xs text-gray-400 dark:text-gray-500">{t('links.noFile')}</p>;
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="px-3 py-1.5 shrink-0 flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700"
        title={snap.root ?? ''}
      >
        <Library className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{snap.root ? basename(snap.root) : '—'}</span>
        <span className="ml-auto shrink-0">
          {snap.status === 'scanning'
            ? t('links.indexing')
            : tn(snap.count, 'links.notesOne', 'links.notesOther')}
        </span>
      </div>
      {snap.truncated && (
        <p className="px-3 py-1 text-[11px] italic text-amber-600 dark:text-amber-400">{t('links.truncated')}</p>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {!data ? (
          <p className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500">
            {snap.status === 'scanning' ? t('links.indexing') : t('links.outside')}
          </p>
        ) : (
          <>
            {header('backlinks', t('links.backlinks'), data.backlinks.length)}
            {!collapsed.has('backlinks') &&
              (data.backlinks.length === 0
                ? none
                : data.backlinks.map(({ source, links }) => (
                    <div key={source.key} className="mb-1">
                      <button
                        type="button"
                        onClick={() => onOpenBacklink(source.path)}
                        title={source.rel}
                        className="w-full px-2 pl-5 py-0.5 flex items-center gap-1.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200/70 dark:hover:bg-gray-700/70"
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{source.name}</span>
                        {links.length > 1 && (
                          <span className="ml-auto shrink-0 text-[10px] text-gray-400">{links.length}</span>
                        )}
                      </button>
                      <p className="pl-10 pr-2 text-[11px] text-gray-400 dark:text-gray-500 truncate">
                        {source.content.split('\n')[links[0].line - 1]?.trim()}
                      </p>
                    </div>
                  )))}

            {header('outgoing', t('links.outgoing'), data.outgoing.length)}
            {!collapsed.has('outgoing') &&
              (data.outgoing.length === 0
                ? none
                : data.outgoing.map(({ occ, path }) => (
                    <button
                      key={`${occ.start}`}
                      type="button"
                      onClick={() => onOpenOutgoing(occ)}
                      title={path ?? t('links.missing')}
                      className={`w-full px-2 pl-5 py-0.5 flex items-center gap-1.5 text-left text-sm hover:bg-gray-200/70 dark:hover:bg-gray-700/70 ${
                        path ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500 italic'
                      }`}
                    >
                      {path ? (
                        <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      ) : (
                        <FilePlus className="w-3.5 h-3.5 shrink-0 opacity-60" />
                      )}
                      <span className="truncate">
                        {occ.kind === 'wiki'
                          ? wikiDisplay({ ...occ, alias: '' })
                          : occ.alias || basename(occ.target)}
                      </span>
                    </button>
                  )))}

            {header('unlinked', t('links.unlinked'), data.unlinked.length)}
            {!collapsed.has('unlinked') &&
              (data.unlinked.length === 0
                ? none
                : data.unlinked.map(({ source, lines }) => (
                    <div key={source.key} className="mb-1">
                      <div className="px-2 pl-5 py-0.5 flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                        <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
                        <span className="truncate" title={source.rel}>{source.name}</span>
                      </div>
                      {lines.map((l) => (
                        <button
                          key={l.line}
                          type="button"
                          onClick={() => onOpenMention(source.path)}
                          className="w-full pl-10 pr-2 py-0.5 text-left text-[11px] text-gray-500 dark:text-gray-400 truncate hover:bg-gray-200/70 dark:hover:bg-gray-700/70"
                        >
                          {l.text}
                        </button>
                      ))}
                    </div>
                  )))}
          </>
        )}
      </div>
    </div>
  );
};
