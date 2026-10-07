import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FileText, Hash, FilePlus } from 'lucide-react';
import type { LinkCandidate } from '../lib/linkContext';
import type { SuggestionMenuProps, SuggestionMenuRef } from '../extensions/suggestionPopup';
import { t } from '../lib/i18n';

const ICONS = { note: FileText, heading: Hash, new: FilePlus } as const;

// Popup del autocompletado de `[[`: notas de la bóveda, secciones de una nota
// (tras `#`) o «crear nota». Mismo manejo de teclado que el menú `/`; además
// Tab acepta la sugerencia.
export const WikiLinkMenu = forwardRef<SuggestionMenuRef, SuggestionMenuProps<LinkCandidate>>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setSelected(0), [items]);

    useEffect(() => {
      const node = listRef.current?.children[selected] as HTMLElement | undefined;
      node?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false;
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="w-72 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl px-3 py-2 text-sm italic text-gray-400 dark:text-gray-500">
          {t('wikilink.noNotes')}
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="w-80 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
      >
        {items.map((item, i) => {
          const Icon = ICONS[item.kind];
          return (
            <button
              key={`${item.kind}:${item.detail ?? ''}:${item.label}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
              onMouseEnter={() => setSelected(i)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                i === selected
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className="w-4 h-4 opacity-70 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                {item.detail && (
                  <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
                    {item.detail}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);

WikiLinkMenu.displayName = 'WikiLinkMenu';
