import { open, save, ask } from '@tauri-apps/plugin-dialog';
import {
  readTextFile,
  writeTextFile,
  writeFile,
  mkdir,
  exists,
} from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { setImageBaseDir } from '../extensions/localImage';

export const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown'] }];

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

export const readDocument = async (path: string): Promise<string> => {
  await allowDocumentDir(path);
  return readTextFile(path);
};

export const writeDocument = async (path: string, markdown: string): Promise<void> => {
  await writeTextFile(path, markdown);
};

export const pickOpenPath = async (): Promise<string | null> => {
  const selected = await open({ multiple: false, filters: MD_FILTERS });
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

export const pickSavePath = async (suggestedName = 'documento.md'): Promise<string | null> => {
  const path = await save({ defaultPath: suggestedName, filters: MD_FILTERS });
  if (!path) return null;
  // Asegura extensión .md
  return /\.(md|markdown)$/i.test(path) ? path : `${path}.md`;
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
