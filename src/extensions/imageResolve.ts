// Resolución de rutas de imágenes con estado del directorio del documento.
// Módulo hoja (no importa la extensión ni el NodeView) para evitar ciclos:
// localImage.ts y ImageNodeView.tsx importan de aquí.
//
// Las imágenes conservan su ruta relativa al documento (p. ej.
// `assets/img-123.png`) para que el .md guardado sea portable; para MOSTRARLAS
// la webview necesita una URL del asset protocol de Tauri (convertFileSrc).

let docDir: string | null = null;
let convertFileSrcFn: ((path: string) => string) | null = null;

// Import perezoso del API de Tauri: en vitest/jsdom no existe el runtime.
const ensureConvert = () => {
  if (convertFileSrcFn) return convertFileSrcFn;
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
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

/** Une `base` + `rel` y colapsa los segmentos `.`/`..` a una ruta absoluta.
 *  Necesario para rutas como `../instance/img.png`: sin normalizar, el asset
 *  protocol de Tauri recibe `…/docs/../instance/img.png` y la comprobación de
 *  scope (que compara contra el directorio permitido canónico) la rechaza, por
 *  lo que la imagen no se dibuja. El separador de salida es el de `base`. */
export const joinAndNormalize = (base: string, rel: string): string => {
  const sep = base.includes('\\') ? '\\' : '/';
  const raw = `${base}${base.endsWith(sep) ? '' : sep}${rel}`;
  const stack: string[] = [];
  const parts = raw.split(/[/\\]/);
  parts.forEach((p, i) => {
    if (p === '.') return;
    if (p === '') {
      if (i === 0) stack.push(''); // conserva la raíz "/" de rutas POSIX
      return;
    }
    if (p === '..') {
      const top = stack[stack.length - 1];
      if (stack.length && top !== '' && top !== '..') stack.pop();
      return;
    }
    stack.push(p);
  });
  return stack.join(sep) || sep;
};

/** Resuelve el src para MOSTRAR en la webview (asset protocol de Tauri). */
export const resolveSrc = (src: string): string => {
  if (!isRelative(src) || !docDir) return src;
  const fn = convertFileSrcFn || ensureConvert();
  if (!fn) return src;
  return fn(joinAndNormalize(docDir, src));
};

/** Ruta absoluta en disco de un asset relativo (p. ej. para abrirlo en un
 *  editor externo), o null si el src no es un asset local del documento. */
export const resolveAssetFsPath = (src: string): string | null =>
  isRelative(src) && docDir ? joinAndNormalize(docDir, src) : null;
