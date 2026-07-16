import { open, save, ask } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  writeTextFile,
  writeFile,
  mkdir,
  exists,
  stat,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { setImageBaseDir, joinAndNormalize } from '../extensions/localImage';

export const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

// Extensiones de texto plano que la app abre en modo fuente (sin pipeline
// markdown). El glob *.env también captura dotfiles como ".env".
const TEXT_EXTENSIONS = [
  'txt', 'text', 'env', 'ini', 'conf', 'cfg', 'log', 'json', 'yaml', 'yml',
  'toml', 'csv', 'tsv', 'xml', 'properties', 'gitignore', 'editorconfig',
];

export const OPEN_FILTERS = [
  {
    name: 'Documentos compatibles',
    extensions: ['md', 'markdown', ...TEXT_EXTENSIONS],
  },
  ...MD_FILTERS,
  { name: 'Texto', extensions: TEXT_EXTENSIONS },
  { name: 'Todos los archivos', extensions: ['*'] },
];

/** ¿El archivo se edita como markdown (WYSIWYG)? Lo demás va como texto
 *  plano en la vista de código fuente. */
export const isMarkdownPath = (path: string): boolean =>
  /\.(md|markdown)$/i.test(path);

/** ¿Extensión de texto editable? (para drag & drop de archivos sueltos) */
export const isTextPath = (path: string): boolean => {
  const name = basename(path).toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => name.endsWith(`.${ext}`)) || !name.includes('.');
};

const dirname = (path: string): string => {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
};

export const basename = (path: string): string => {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx >= 0 ? path.slice(idx + 1) : path;
};

/** Habilita el asset protocol para el directorio del documento y configura
 *  la resolución de imágenes relativas. Llamar en open/save-as ANTES de
 *  setContent. */
export const allowDocumentDir = async (filePath: string): Promise<string> => {
  const dir = dirname(filePath);
  try {
    await invoke('allow_asset_dir', { path: dir });
  } catch (err) {
    console.error('allow_asset_dir falló:', err);
  }
  await setImageBaseDir(dir);
  return dir;
};

/** Extrae los `src` de imágenes markdown `![alt](src)` y HTML `<img src=…>`. */
const extractImageSrcs = (content: string): string[] => {
  const srcs: string[] = [];
  const mdImg = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  const htmlImg = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = mdImg.exec(content)) !== null) srcs.push(m[1]);
  while ((m = htmlImg.exec(content)) !== null) srcs.push(m[1]);
  return srcs;
};

const isRelativeImg = (src: string): boolean =>
  !!src && !/^(?:[a-z]+:)?\/\//i.test(src) && !src.startsWith('data:') &&
  !src.startsWith('asset:') && !src.startsWith('/');

/** Habilita el asset protocol para TODOS los directorios donde viven las
 *  imágenes referenciadas, no sólo el del documento. Las rutas relativas
 *  pueden apuntar fuera de `docDir` (p. ej. `../instance/…/img.png`); sin
 *  permitir ese directorio, el webview bloquea la imagen y no se dibuja. */
export const allowImageDirs = async (content: string, docDir: string): Promise<void> => {
  const dirs = new Set<string>();
  for (const src of extractImageSrcs(content)) {
    if (!isRelativeImg(src)) continue;
    dirs.add(dirname(joinAndNormalize(docDir, src)));
  }
  await Promise.all(
    [...dirs].map((d) =>
      invoke('allow_asset_dir', { path: d }).catch((err) =>
        console.error('allow_asset_dir (imagen) falló:', d, err)
      )
    )
  );
};

export const readDocument = async (path: string): Promise<string> => {
  const dir = await allowDocumentDir(path);
  const content = await readTextFile(path);
  await allowImageDirs(content, dir);
  return content;
};

export const writeDocument = async (path: string, markdown: string): Promise<void> => {
  await writeTextFile(path, markdown);
};

/** Fecha de modificación en ms, o null si no se puede leer. Base de la
 *  detección de cambios externos al archivo abierto. */
export const getMtime = async (path: string): Promise<number | null> => {
  try {
    const info = await stat(path);
    return info.mtime ? new Date(info.mtime).getTime() : null;
  } catch {
    return null;
  }
};

export const confirmReloadExternal = async (docName: string): Promise<boolean> =>
  ask(
    `«${docName}» cambió en el disco y aquí tienes cambios sin guardar.\n¿Recargar del disco? (tus cambios de esta pestaña se pierden)`,
    {
      title: 'iureditor — Archivo modificado',
      kind: 'warning',
      okLabel: 'Recargar del disco',
      cancelLabel: 'Conservar mi versión',
    }
  );

export const confirmOverwriteExternal = async (docName: string): Promise<boolean> =>
  ask(
    `«${docName}» cambió en el disco después de abrirse aquí.\n¿Sobrescribir con tu versión?`,
    {
      title: 'iureditor — Archivo modificado',
      kind: 'warning',
      okLabel: 'Sobrescribir',
      cancelLabel: 'Cancelar',
    }
  );

export const pickOpenPath = async (): Promise<string | null> => {
  const selected = await open({ multiple: false, filters: OPEN_FILTERS });
  return typeof selected === 'string' ? selected : null;
};

export const pickImagePath = async (): Promise<string | null> => {
  const selected = await open({
    multiple: false,
    filters: [
      { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
    ],
  });
  return typeof selected === 'string' ? selected : null;
};

export const pickSavePath = async (
  suggestedName = 'documento.md',
  forceMd = true
): Promise<string | null> => {
  const path = await save({
    defaultPath: suggestedName,
    filters: forceMd ? MD_FILTERS : [{ name: 'Todos los archivos', extensions: ['*'] }],
  });
  if (!path) return null;
  // Asegura extensión .md sólo para documentos markdown; un .env/.txt
  // conserva su nombre tal cual.
  if (forceMd && !/\.(md|markdown)$/i.test(path)) return `${path}.md`;
  return path;
};

export const confirmDiscard = async (): Promise<boolean> =>
  ask('Hay cambios sin guardar. ¿Descartarlos?', {
    title: 'iureditor',
    kind: 'warning',
    okLabel: 'Descartar',
    cancelLabel: 'Cancelar',
  });

export const confirmRecoverDrafts = async (
  docNames: string[],
  savedAt: number
): Promise<boolean> => {
  const list = docNames.map((n) => `• ${n}`).join('\n');
  const msg =
    docNames.length === 1
      ? `Se encontró un borrador sin guardar de «${docNames[0]}» (${new Date(savedAt).toLocaleString()}).\n¿Quieres recuperarlo?`
      : `Se encontraron ${docNames.length} borradores sin guardar (${new Date(savedAt).toLocaleString()}):\n${list}\n¿Quieres recuperarlos?`;
  return ask(msg, {
    title: 'iureditor — Recuperar borradores',
    kind: 'info',
    okLabel: 'Recuperar',
    cancelLabel: 'Descartar borradores',
  });
};

/**
 * Guarda los bytes de una imagen pegada/soltada en `<dir-del-doc>/assets/` y
 * devuelve la ruta relativa a insertar en el documento.
 */
export const saveImageToAssets = async (
  docPath: string,
  file: File
): Promise<string> => {
  const dir = dirname(docPath);
  const assetsDir = `${dir}/assets`;
  if (!(await exists(assetsDir))) {
    await mkdir(assetsDir, { recursive: true });
  }
  const extFromType = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  const baseName = file.name && file.name !== 'image.png'
    ? file.name.replace(/[^\w.-]+/g, '_')
    : `img-${Date.now()}.${extFromType}`;
  let target = `${assetsDir}/${baseName}`;
  if (await exists(target)) {
    target = `${assetsDir}/${Date.now()}-${baseName}`;
  }
  await writeFile(target, new Uint8Array(await file.arrayBuffer()));
  return `assets/${basename(target)}`;
};

// ---------- Archivos recientes (plugin-store) ----------

const RECENT_STORE = 'recent.json';
const RECENT_KEY = 'recentFiles';
const RECENT_MAX = 10;

export const getRecentFiles = async (): Promise<string[]> => {
  try {
    const store = await load(RECENT_STORE, { autoSave: true, defaults: {} });
    return ((await store.get<string[]>(RECENT_KEY)) || []).filter(Boolean);
  } catch {
    return [];
  }
};

export const addRecentFile = async (path: string): Promise<string[]> => {
  try {
    const store = await load(RECENT_STORE, { autoSave: true, defaults: {} });
    const current = ((await store.get<string[]>(RECENT_KEY)) || []).filter(
      (p) => p !== path
    );
    const updated = [path, ...current].slice(0, RECENT_MAX);
    await store.set(RECENT_KEY, updated);
    return updated;
  } catch {
    return [path];
  }
};
