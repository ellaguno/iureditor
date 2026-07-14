import { load } from '@tauri-apps/plugin-store';

// Autoguardado de borrador para recuperación tras un cierre inesperado.
// Un solo borrador (la app es de documento único), vía plugin-store: el
// scope del plugin fs no cruza directorios ocultos (~/.local), así que
// escribir directo al app data dir fallaba en silencio; el store gestiona
// su propio archivo sin pasar por ese scope.

const STORE_FILE = 'draft.json';
const KEY = 'draft';

export interface Draft {
  /** Ruta del documento, o null si era "Sin título". */
  path: string | null;
  markdown: string;
  savedAt: number;
}

const getStore = () => load(STORE_FILE, { autoSave: true, defaults: {} });

export const saveDraft = async (path: string | null, markdown: string): Promise<void> => {
  try {
    const store = await getStore();
    const draft: Draft = { path, markdown, savedAt: Date.now() };
    await store.set(KEY, draft);
  } catch (err) {
    // El autoguardado nunca debe interrumpir la edición.
    console.error('No se pudo escribir el borrador:', err);
  }
};

export const loadDraft = async (): Promise<Draft | null> => {
  try {
    const store = await getStore();
    const draft = await store.get<Draft>(KEY);
    if (!draft || typeof draft.markdown !== 'string' || !draft.markdown.trim()) return null;
    return draft;
  } catch {
    return null;
  }
};

export const clearDraft = async (): Promise<void> => {
  try {
    const store = await getStore();
    await store.delete(KEY);
  } catch (err) {
    console.error('No se pudo eliminar el borrador:', err);
  }
};
