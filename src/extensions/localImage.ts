import Image from '@tiptap/extension-image';
import { mergeAttributes } from '@tiptap/core';

// Imágenes con rutas relativas al documento (p. ej. `assets/img-123.png`).
// El modelo conserva la ruta relativa (así el .md guardado queda portable);
// para MOSTRARLA la webview necesita una URL del asset protocol de Tauri
// (convertFileSrc). La ruta original viaja en data-orig-src y la regla de
// Turndown / parseHTML la recupera.

let docDir: string | null = null;
let convertFileSrcFn: ((path: string) => string) | null = null;

// Import perezoso del API de Tauri: en vitest/jsdom no existe el runtime.
const ensureConvert = () => {
  if (convertFileSrcFn) return convertFileSrcFn;
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      // import estático evitado: sólo disponible dentro de Tauri
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      import('@tauri-apps/api/core').then((m) => {
        convertFileSrcFn = m.convertFileSrc;
      });
    }
  } catch {
    /* fuera de Tauri (tests, navegador) las relativas quedan sin resolver */
  }
  return convertFileSrcFn;
};

/** La app llama esto al abrir/guardar-como, después de allow_asset_dir. */
export const setImageBaseDir = async (dir: string | null) => {
  docDir = dir;
  if (dir && !convertFileSrcFn) {
    try {
      const m = await import('@tauri-apps/api/core');
      convertFileSrcFn = m.convertFileSrc;
    } catch {
      /* no-op fuera de Tauri */
    }
  }
};

const isRelative = (src: string): boolean =>
  !!src && !/^(?:[a-z]+:)?\/\//i.test(src) && !src.startsWith('data:') &&
  !src.startsWith('asset:') && !src.startsWith('/') && !src.startsWith('http');

const resolveSrc = (src: string): string => {
  if (!isRelative(src) || !docDir) return src;
  const fn = convertFileSrcFn || ensureConvert();
  if (!fn) return src;
  const sep = docDir.includes('\\') ? '\\' : '/';
  const joined = `${docDir}${docDir.endsWith(sep) ? '' : sep}${src.replaceAll('/', sep)}`;
  return fn(joined);
};

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
});
