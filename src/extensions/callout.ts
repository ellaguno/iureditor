import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutNodeView } from '../components/CalloutNodeView';

// Callouts / admoniciones estilo GitHub-Obsidian. En markdown viven como un
// blockquote cuya primera línea es `[!TIPO]` (p. ej. `> [!NOTE]`); markdown.ts
// los convierte en <div data-callout="tipo"> y la regla de Turndown los
// devuelve al blockquote. El contenido son bloques normales (párrafos, listas…).

export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// Clave i18n literal por tipo (t() exige claves de la unión, no template string).
export const CALLOUT_LABEL_KEY = {
  note: 'callout.note',
  tip: 'callout.tip',
  important: 'callout.important',
  warning: 'callout.warning',
  caution: 'callout.caution',
} as const;

const isCalloutType = (t: string): t is CalloutType =>
  (CALLOUT_TYPES as readonly string[]).includes(t);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Envuelve la selección en un callout del tipo dado. */
      setCallout: (type?: CalloutType) => ReturnType;
      /** Alterna un callout del tipo dado. */
      toggleCallout: (type?: CalloutType) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      type: {
        default: 'note',
        parseHTML: (el) => {
          const t = el.getAttribute('data-callout') || 'note';
          return isCalloutType(t) ? t : 'note';
        },
        renderHTML: (attrs) => ({ 'data-callout': attrs.type }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }, { tag: 'blockquote[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'iur-callout' }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (type = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { type }),
      toggleCallout:
        (type = 'note') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { type }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});
