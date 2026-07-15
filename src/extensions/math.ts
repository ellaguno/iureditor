import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MathNodeView } from '../components/MathNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      /** Inserta una fórmula en línea ($…$). */
      insertMathInline: (latex?: string) => ReturnType;
      /** Inserta una fórmula en bloque ($$…$$). */
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

// Fórmulas LaTeX con render KaTeX en vivo. lib/markdown.ts convierte
// `$…$` → <span data-math-inline data-latex="…"> y `$$…$$` →
// <div data-math-block data-latex="…"> al cargar; Turndown las devuelve a la
// sintaxis original al guardar. El LaTeX va también como texto interno para
// que Turndown nunca descarte el nodo por vacío (isBlank).

const latexAttribute = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) =>
      element.getAttribute('data-latex') ?? element.textContent ?? '',
    renderHTML: () => ({}),
  },
};

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex: string = node.attrs.latex || '';
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-math-inline': 'true', 'data-latex': latex }),
      latex,
    ];
  },

  addCommands() {
    return {
      insertMathInline:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex: string = node.attrs.latex || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': 'true', 'data-latex': latex }),
      latex,
    ];
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView);
  },
});
