import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { ReactRenderer } from '@tiptap/react';
import { computePosition, flip, shift, offset } from '@floating-ui/dom';
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Table as TableIcon,
  Workflow,
  Sigma,
  Minus,
  Info,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { SlashMenu } from '../components/SlashMenu';
import type { SlashMenuRef, SlashMenuProps } from '../components/SlashMenu';
import { CALLOUT_TYPES, CALLOUT_LABEL_KEY } from './callout';
import type { CalloutType } from './callout';
import { t } from '../lib/i18n';

type IconType = React.ComponentType<{ className?: string }>;

export interface SlashItem {
  title: string;
  /** Palabras clave (es+en) para filtrar, separadas por espacio. */
  keywords: string;
  icon: IconType;
  command: (opts: { editor: Editor; range: Range }) => void;
}

const CALLOUT_ICONS: Record<CalloutType, IconType> = {
  note: Info,
  tip: Lightbulb,
  important: AlertCircle,
  warning: AlertTriangle,
  caution: ShieldAlert,
};

// Se reconstruye en cada consulta para reflejar el idioma actual.
const buildItems = (): SlashItem[] => {
  const items: SlashItem[] = [
    {
      title: t('slash.heading1'),
      keywords: 'title heading titulo encabezado h1 #',
      icon: Heading1,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
    },
    {
      title: t('slash.heading2'),
      keywords: 'title heading titulo encabezado h2 ##',
      icon: Heading2,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
    },
    {
      title: t('slash.heading3'),
      keywords: 'title heading titulo encabezado h3 ###',
      icon: Heading3,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
    },
    {
      title: t('slash.bulletList'),
      keywords: 'bullet list unordered lista viñetas',
      icon: List,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: t('slash.orderedList'),
      keywords: 'ordered numbered list lista numerada',
      icon: ListOrdered,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: t('slash.taskList'),
      keywords: 'task todo checkbox tareas lista',
      icon: ListChecks,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      title: t('slash.quote'),
      keywords: 'quote blockquote cita',
      icon: Quote,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: t('slash.codeBlock'),
      keywords: 'code block codigo pre',
      icon: Code,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setCodeBlock().run(),
    },
    {
      title: t('slash.table'),
      keywords: 'table tabla grid',
      icon: TableIcon,
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: t('slash.diagram'),
      keywords: 'diagram mermaid diagrama flowchart',
      icon: Workflow,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertMermaid().run(),
    },
    {
      title: t('slash.mathBlock'),
      keywords: 'math formula latex katex ecuacion formula',
      icon: Sigma,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).insertMathBlock().run(),
    },
    {
      title: t('slash.divider'),
      keywords: 'divider horizontal rule separador hr line',
      icon: Minus,
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ];

  // Callouts (uno por tipo).
  for (const ct of CALLOUT_TYPES) {
    items.push({
      title: `${t('slash.callout')}: ${t(CALLOUT_LABEL_KEY[ct])}`,
      keywords: `callout admonition aviso nota ${ct}`,
      icon: CALLOUT_ICONS[ct],
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setCallout(ct).run(),
    });
  }

  return items;
};

const filterItems = (query: string): SlashItem[] => {
  const q = query.trim().toLowerCase();
  const all = buildItems();
  if (!q) return all;
  return all.filter(
    (item) =>
      item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q)
  );
};

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        // Ejecuta el comando del ítem elegido tras borrar el `/consulta`.
        command: ({ editor, range, props }) => props.command({ editor, range }),
        items: ({ query }) => filterItems(query),
        render: () => {
          let component: ReactRenderer<SlashMenuRef, SlashMenuProps> | null = null;
          let el: HTMLElement | null = null;

          const reposition = (props: SuggestionProps<SlashItem>) => {
            if (!el || !props.clientRect) return;
            const rect = props.clientRect();
            if (!rect) return;
            const virtual = { getBoundingClientRect: () => rect };
            void computePosition(virtual, el, {
              placement: 'bottom-start',
              middleware: [offset(6), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
              if (!el) return;
              el.style.left = `${x}px`;
              el.style.top = `${y}px`;
            });
          };

          const props2 = (props: SuggestionProps<SlashItem>): SlashMenuProps => ({
            items: props.items,
            command: (item) => props.command(item),
          });

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: props2(props),
                editor: props.editor,
              });
              el = component.element as HTMLElement;
              el.style.position = 'absolute';
              el.style.top = '0';
              el.style.left = '0';
              el.style.zIndex = '50';
              document.body.appendChild(el);
              reposition(props);
            },
            onUpdate: (props) => {
              if (el) el.style.display = '';
              component?.updateProps(props2(props));
              reposition(props);
            },
            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                if (el) el.style.display = 'none';
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              el?.remove();
              component?.destroy();
              component = null;
              el = null;
            },
          };
        },
      }),
    ];
  },
});
