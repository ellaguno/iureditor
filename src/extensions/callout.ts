import { Node, mergeAttributes } from '@tiptap/core';
import { findWrapping } from '@tiptap/pm/transform';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutNodeView } from '../components/CalloutNodeView';

// Callouts / admoniciones estilo GitHub-Obsidian. En markdown viven como un
// blockquote cuya primera línea es `[!TIPO]` (p. ej. `> [!NOTE]`); markdown.ts
// los convierte en <div data-callout="tipo"> y la regla de Turndown los
// devuelve al blockquote. El contenido son bloques normales (párrafos, listas…).

// `mindmap` no es un aviso: su lista se dibuja como mapa mental (lib/mindmap.ts).
export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution', 'mindmap'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

// Clave i18n literal por tipo (t() exige claves de la unión, no template string).
export const CALLOUT_LABEL_KEY = {
  note: 'callout.note',
  tip: 'callout.tip',
  important: 'callout.important',
  warning: 'callout.warning',
  caution: 'callout.caution',
  mindmap: 'callout.mindmap',
} as const;

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

const isCalloutType = (t: string): t is CalloutType =>
  (CALLOUT_TYPES as readonly string[]).includes(t);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Envuelve la selección en un callout del tipo dado. */
      setCallout: (type?: CalloutType) => ReturnType;
      /** Alterna un callout del tipo dado. */
      toggleCallout: (type?: CalloutType) => ReturnType;
      /** Convierte en mapa mental la lista del cursor (con el párrafo que la
       *  precede como centro), o lo deshace si ya lo es. */
      toggleMindmap: () => ReturnType;
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
      // Forma de los nodos de un mapa mental (`> [!MINDMAP|forma]`).
      shape: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-shape'),
        renderHTML: (attrs) => (attrs.shape ? { 'data-shape': attrs.shape } : {}),
      },
      // Mapa de enlaces generado (`> [!MINDMAP|links]`): se puede regenerar.
      links: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-links'),
        renderHTML: (attrs) => (attrs.links ? { 'data-links': '' } : {}),
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
      toggleMindmap:
        () =>
        ({ state, tr, dispatch, commands }) => {
          const { $from } = state.selection;
          // Dentro de un mapa: se deshace (el contenido vuelve a ser texto normal).
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === this.name && node.attrs.type === 'mindmap') {
              if (dispatch) tr.replaceWith($from.before(d), $from.after(d), node.content);
              return true;
            }
          }
          // En una lista: se envuelve la lista entera (la más externa) y, si
          // justo antes hay un párrafo, también: es el centro del mapa.
          let listDepth = 0;
          for (let d = $from.depth; d > 0; d--) {
            if (LIST_TYPES.has($from.node(d).type.name)) listDepth = d;
          }
          if (!listDepth) return commands.setCallout('mindmap');
          const listStart = $from.before(listDepth);
          const listEnd = $from.after(listDepth);
          const $list = state.doc.resolve(listStart);
          const prev = $list.nodeBefore;
          const start = prev?.type.name === 'paragraph' ? listStart - prev.nodeSize : listStart;
          const range = state.doc.resolve(start + 1).blockRange(state.doc.resolve(listEnd - 1));
          const wrapping = range && findWrapping(range, this.type, { type: 'mindmap' });
          if (!range || !wrapping) return false;
          if (dispatch) tr.wrap(range, wrapping).scrollIntoView();
          return true;
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutNodeView);
  },
});
