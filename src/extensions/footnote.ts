import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Inserta una referencia de nota al pie y su definición al final. */
      insertFootnote: () => ReturnType;
    };
  }
}

// Notas al pie estilo markdown: `[^1]` como referencia inline y `[^1]: texto`
// como definición. lib/markdown.ts convierte ambas al cargar
// (<sup data-fn-ref> / <div data-fn-def>) y las reglas de Turndown las
// devuelven a la sintaxis original al guardar.

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: {
        default: '1',
        parseHTML: (element) => element.getAttribute('data-fn-ref') || '1',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    // Prioridad > 50 para ganarle a la marca Superscript, que también
    // reclama <sup>.
    return [{ tag: 'sup[data-fn-ref]', priority: 60 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label: string = node.attrs.label || '';
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-fn-ref': label }), label];
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ editor, chain }) => {
          // Siguiente etiqueta numérica libre (considera refs y definiciones).
          const used: number[] = [];
          editor.state.doc.descendants((node) => {
            if (node.type.name === 'footnoteRef' || node.type.name === 'footnoteDef') {
              const n = parseInt(String(node.attrs.label), 10);
              if (!Number.isNaN(n)) used.push(n);
            }
          });
          const label = String(used.length ? Math.max(...used) + 1 : 1);

          const ok = chain()
            .insertContent({ type: 'footnoteRef', attrs: { label } })
            .insertContentAt(editor.state.doc.content.size, {
              type: 'footnoteDef',
              attrs: { label },
            })
            .run();
          if (!ok) return false;

          // Lleva el cursor a la definición recién creada para escribirla.
          let defPos: number | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'footnoteDef' && node.attrs.label === label) {
              defPos = pos;
            }
          });
          if (defPos !== null) {
            editor.chain().focus().setTextSelection(defPos + 1).scrollIntoView().run();
          }
          return true;
        },
    };
  },
});

export const FootnoteDef = Node.create({
  name: 'footnoteDef',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      label: {
        default: '1',
        parseHTML: (element) => element.getAttribute('data-fn-def') || '1',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-fn-def]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label: string = node.attrs.label || '';
    return ['div', mergeAttributes(HTMLAttributes, { 'data-fn-def': label }), 0];
  },
});
