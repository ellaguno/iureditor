// Imágenes que llegan al editor por vías «transitorias» y hay que fijar en
// `assets/` junto al documento para que el markdown sea portable:
//
//  - `data:` (HTML copiado de un navegador o de un correo con la imagen
//    incrustada en base64);
//  - `blob:` (el pegado nativo de WebKitGTK de una captura crea un <img>
//    con URL blob, válida sólo mientras vive la ventana — guardada en el
//    archivo, al reabrir no se veía nada);
//  - `file:` (HTML copiado de LibreOffice u otra app local) y rutas o URIs
//    de archivo pegadas como texto plano (copiar un archivo en el gestor de
//    archivos y pegar en el editor).

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

export const mimeForPath = (path: string): string => {
  const ext = (/\.([a-z0-9]+)$/i.exec(path)?.[1] || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
};

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

export const extForMime = (mime: string): string => EXT_BY_MIME[mime.toLowerCase()] || 'png';

/** `file:///home/u/foto.png` → `/home/u/foto.png`; `file:///C:/x.png` → `C:/x.png`. */
export const fileUriToPath = (uri: string): string | null => {
  const m = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(uri.trim());
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    path = m[1];
  }
  // Windows: file:///C:/ruta → C:/ruta
  if (/^\/[a-z]:[\\/]/i.test(path)) path = path.slice(1);
  return path;
};

export const isImagePath = (path: string): boolean => IMAGE_EXT.test(path.trim());

/** Ruta local de una imagen pegada como TEXTO: una URI `file:` o una ruta
 *  absoluta (POSIX o Windows) con extensión de imagen. Sólo una línea. */
export const imagePathFromText = (text: string): string | null => {
  const line = text.trim();
  if (!line || /[\r\n]/.test(line)) return null;
  const fromUri = fileUriToPath(line);
  if (fromUri) return isImagePath(fromUri) ? fromUri : null;
  if ((/^\//.test(line) || /^[a-z]:[\\/]/i.test(line)) && isImagePath(line)) return line;
  return null;
};

/** Primera imagen local de un `text/uri-list` (gestores de archivos). */
export const imagePathFromUriList = (uriList: string): string | null => {
  for (const raw of uriList.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const path = fileUriToPath(line);
    if (path && isImagePath(path)) return path;
  }
  return null;
};

/** ¿El src de una imagen es transitorio y hay que fijarlo en assets/? */
export const isTransientImageSrc = (src: string | null | undefined): boolean =>
  !!src && /^(?:data:|blob:|file:)/i.test(src);

const base64ToBytes = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));

export const basenameOf = (path: string): string => path.split(/[/\\]/).pop() || 'image';

/** Convierte un src transitorio en un File listo para guardarse en assets/.
 *  `readLocal` lee bytes de una ruta en disco (inyectado: en Tauri es
 *  plugin-fs; en pruebas, un stub). null si no se pudo obtener la imagen. */
export const fileFromTransientSrc = async (
  src: string,
  readLocal: (path: string) => Promise<Uint8Array | null>
): Promise<File | null> => {
  const stamp = Date.now();
  if (/^data:/i.test(src)) {
    const comma = src.indexOf(',');
    if (comma < 0) return null;
    const header = src.slice(5, comma); // p. ej. `image/png;base64`
    const payload = src.slice(comma + 1);
    const mime = (header.split(';')[0] || 'image/png').toLowerCase();
    const isBase64 = /;base64$/i.test(header);
    const bytes = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(decodeURIComponent(payload));
    return new File([bytes], `pasted-${stamp}.${extForMime(mime)}`, { type: mime });
  }
  if (/^blob:/i.test(src)) {
    try {
      const blob = await fetch(src).then((r) => r.blob());
      const mime = blob.type || 'image/png';
      return new File([blob], `pasted-${stamp}.${extForMime(mime)}`, { type: mime });
    } catch {
      return null;
    }
  }
  if (/^file:/i.test(src)) {
    const path = fileUriToPath(src);
    if (!path) return null;
    return fileFromLocalPath(path, readLocal);
  }
  return null;
};

export const fileFromLocalPath = async (
  path: string,
  readLocal: (path: string) => Promise<Uint8Array | null>
): Promise<File | null> => {
  const bytes = await readLocal(path);
  if (!bytes) return null;
  return new File([bytes], basenameOf(path), { type: mimeForPath(path) });
};

/** Lector de archivos locales para producción (plugin-fs de Tauri). Fuera de
 *  Tauri (pruebas, navegador) devuelve null. */
export const readLocalBytes = async (path: string): Promise<Uint8Array | null> => {
  try {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return null;
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return await readFile(path);
  } catch (err) {
    console.error(`No se pudo leer la imagen ${path}:`, err);
    return null;
  }
};
