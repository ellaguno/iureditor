import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, FilePlus, Terminal } from 'lucide-react';
import { vault, useVault } from '../lib/vault';
import { fuzzyFilter, foldText } from '../lib/fuzzy';
import { basename, dirname } from '../lib/fileio';
import { normPath } from '../lib/vaultIndex';
import { t } from '../lib/i18n';

export type PaletteMode = 'files' | 'commands';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

type Item =
  | { kind: 'file'; key: string; label: string; detail: string; path: string }
  | { kind: 'new'; key: string; label: string; name: string }
  | { kind: 'command'; key: string; label: string; detail?: string; command: PaletteCommand };

const MAX_ITEMS = 60;

// Selector rápido (Ctrl+K: ir a una nota de la bóveda o a un reciente, o
// crearla) y paleta de comandos (Ctrl+Shift+P). Escribir `>` al principio en
// el selector pasa a comandos, como en otros editores.
export const Palette = ({
  mode,
  onClose,
  commands,
  recentFiles,
  onOpenFile,
  onCreateNote,
}: {
  mode: PaletteMode;
  onClose: () => void;
  commands: PaletteCommand[];
  recentFiles: string[];
  onOpenFile: (path: string) => void;
  onCreateNote: (name: string) => void;
}) => {
  const snap = useVault();
  const [query, setQuery] = useState(mode === 'commands' ? '>' : '');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const commandMode = query.startsWith('>');
  const text = commandMode ? query.slice(1) : query;

  const items: Item[] = useMemo(() => {
    if (commandMode) {
      return fuzzyFilter(commands, text, (c) => c.label).map((command) => ({
        kind: 'command',
        key: command.id,
        label: command.label,
        detail: command.shortcut,
        command,
      }));
    }
    const index = vault.index;
    const notes = index?.all() ?? [];
    const inVault = new Set(notes.map((n) => n.key));
    // Recientes primero; luego las notas de la bóveda.
    const files: { path: string; label: string; detail: string; recent: boolean }[] = [];
    const seen = new Set<string>();
    for (const path of recentFiles) {
      const key = normPath(path);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({
        path,
        label: basename(path),
        detail: inVault.has(key) && index ? index.relOf(path) : dirname(path),
        recent: true,
      });
    }
    for (const n of notes) {
      if (seen.has(n.key)) continue;
      seen.add(n.key);
      files.push({ path: n.path, label: n.name, detail: n.rel, recent: false });
    }
    const ranked = text.trim()
      ? fuzzyFilter(files, text, (f) => f.label, { secondary: (f) => f.detail, limit: MAX_ITEMS })
      : files.slice(0, MAX_ITEMS);
    const out: Item[] = ranked.map((f) => ({
      kind: 'file',
      key: f.path,
      label: f.label,
      detail: f.detail,
      path: f.path,
    }));
    const typed = text.trim();
    const exact = ranked.some((f) => foldText(f.label.replace(/\.(md|markdown)$/i, '')) === foldText(typed));
    if (typed && !exact && !/[\\/]$/.test(typed)) {
      out.push({ kind: 'new', key: '__new__', label: t('wikilink.create', { name: typed }), name: typed });
    }
    return out;
    // snap.version: el índice cambió (escaneo en curso).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commandMode, text, commands, recentFiles, snap.version]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    const node = listRef.current?.children[selected] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'file') onOpenFile(item.path);
    else if (item.kind === 'new') onCreateNote(item.name);
    else item.command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) setSelected((s) => (s + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setSelected((s) => (s + items.length - 1) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[selected]);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-center pt-[12vh] bg-black/20" onMouseDown={onClose}>
      <div
        className="w-[min(560px,calc(100vw-32px))] h-fit max-h-[65vh] flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={commandMode ? t('palette.commands') : t('palette.files')}
          className="w-full px-4 py-3 text-sm bg-transparent text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 focus:outline-none"
        />
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-4 py-2 text-sm italic text-gray-400 dark:text-gray-500">
              {!commandMode && snap.status === 'scanning' ? t('links.indexing') : t('palette.empty')}
            </p>
          )}
          {items.map((item, i) => {
            const Icon = item.kind === 'file' ? FileText : item.kind === 'new' ? FilePlus : Terminal;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => choose(item)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full px-4 py-1.5 flex items-center gap-2.5 text-left text-sm ${
                  i === selected
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0 opacity-60" />
                <span className="truncate">{item.label}</span>
                {item.kind !== 'new' && item.detail && (
                  <span className="ml-auto pl-3 shrink min-w-0 truncate text-xs text-gray-400 dark:text-gray-500">
                    {item.detail}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="px-4 py-1.5 text-[11px] text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700">
          {t('palette.hint')}
        </div>
      </div>
    </div>
  );
};
