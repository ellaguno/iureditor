import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MermaidNodeView } from '../components/MermaidNodeView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Inserta un bloque de diagrama mermaid */
      insertMermaid: (code?: string) => ReturnType;
    };
  }
}

// Nodo atómico de bloque para diagramas mermaid. El markdown ```mermaid se
// convierte en <div data-type="mermaid" data-code="..."> al cargar
// (lib/markdown.ts) y la regla `mermaidNode` de Turndown lo devuelve al fence
// verbatim al guardar. El NodeView renderiza el diagrama en vivo.
export const Mermaid = Node.create({
  name: 'mermaid',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (element) => {
          const attr = element.getAttribute('data-code');
          if (attr !== null) return attr;
          // Soporta también <pre><code class="language-mermaid"> (HTML pegado
          // o archivos guardados como HTML).
          return element.textContent || '';
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="mermaid"]' },
      {
        tag: 'pre',
        getAttrs: (node) => {
          const code = (node as HTMLElement).querySelector('code.language-mermaid');
          return code ? {} : false;
        },
        contentElement: 'code.language-mermaid',
        priority: 60,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const code: string = node.attrs.code || '';
    // El código va también como texto interno: Turndown descarta divs vacíos
    // (isBlank) antes de aplicar sus reglas.
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid', 'data-code': code }),
      code,
    ];
  },

  addCommands() {
    return {
      insertMermaid:
        (code = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { code } }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView, {
      // El panel de edición (código, plantillas, asistente) es interfaz propia:
      // si ProseMirror atiende sus clics, el primero sólo selecciona el nodo
      // (y el cuadro se desplaza), y el texto tecleado acaba en el documento.
      stopEvent: ({ event }) =>
        event.target instanceof Element && !!event.target.closest('.iur-mermaid-edit'),
    });
  },
});
