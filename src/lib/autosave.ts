import { load } from '@tauri-apps/plugin-store';

// Autoguardado de borradores para recuperación tras un cierre inesperado.
// Un borrador por pestaña sucia, vía plugin-store: el scope del plugin fs no
// cruza directorios ocultos (~/.local), así que escribir directo al app data
// dir fallaba en silencio; el store gestiona su propio archivo sin pasar por
// ese scope.

const STORE_FILE = 'draft.json';
const KEY = 'drafts';
// Versiones ≤1.1.x guardaban un único borrador bajo esta clave.
const LEGACY_KEY = 'draft';

export interface Draft {
  /** Ruta del documento, o null si era "Sin título". */
  path: string | null;
  markdown: string;
  savedAt: number;
}

const getStore = () => load(STORE_FILE, { autoSave: true, defaults: {} });

const isValid = (d: unknown): d is Draft =>
  !!d && typeof (d as Draft).markdown === 'string' && !!(d as Draft).markdown.trim();

export const saveDrafts = async (drafts: Draft[]): Promise<void> => {
  try {
    const store = await getStore();
    if (drafts.length) {
      await store.set(KEY, drafts);
    } else {
      await store.delete(KEY);
    }
    await store.delete(LEGACY_KEY);
  } catch (err) {
    // El autoguardado nunca debe interrumpir la edición.
    console.error('No se pudieron escribir los borradores:', err);
  }
};

export const loadDrafts = async (): Promise<Draft[]> => {
  try {
    const store = await getStore();
    const drafts = (await store.get<Draft[]>(KEY)) || [];
    const legacy = await store.get<Draft>(LEGACY_KEY);
    return [...drafts, ...(legacy ? [legacy] : [])].filter(isValid);
  } catch {
    return [];
  }
};

export const clearDrafts = async (): Promise<void> => {
  try {
    const store = await getStore();
    await store.delete(KEY);
    await store.delete(LEGACY_KEY);
  } catch (err) {
    console.error('No se pudieron eliminar los borradores:', err);
  }
};
