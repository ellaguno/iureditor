import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageNodeView } from '../components/ImageNodeView';
import { resolveSrc } from './imageResolve';

// Imágenes con rutas relativas al documento (p. ej. `assets/img-123.png`).
// La resolución de rutas y el estado del directorio del documento viven en
// `imageResolve.ts` (módulo hoja, para no crear un ciclo con el NodeView).
// Se re-exportan aquí los helpers que ya consumen fileio.ts y los tests.
export { setImageBaseDir, joinAndNormalize, resolveSrc, resolveAssetFsPath } from './imageResolve';

export const LocalImage = Image.extend({
  name: 'image',

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-orig-src') || element.getAttribute('src'),
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const src: string = node.attrs.src || '';
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: resolveSrc(src),
        'data-orig-src': src,
      }),
    ];
  },

  // NodeView para el menú contextual (abrir en editor externo / borrar). No
  // altera renderHTML, así que la serialización a markdown sigue igual.
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
