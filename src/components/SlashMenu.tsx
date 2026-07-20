import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { SlashItem } from '../extensions/slashCommand';
import { t } from '../lib/i18n';

export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// Popup del menú `/`: lista navegable con teclado. La extensión SlashCommand
// lo monta vía ReactRenderer y delega las teclas en onKeyDown (ref).
export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selected, setSelected] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setSelected(0), [items]);

    // Mantiene el ítem seleccionado visible al navegar con el teclado.
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
        if (event.key === 'Enter') {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl px-3 py-2 text-sm italic text-gray-400 dark:text-gray-500">
          {t('slash.noResults')}
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl py-1"
      >
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={item.title}
              type="button"
              onClick={() => command(item)}
              onMouseEnter={() => setSelected(i)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                i === selected
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Icon className="w-4 h-4 opacity-70 shrink-0" />
              <span className="truncate">{item.title}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

SlashMenu.displayName = 'SlashMenu';
