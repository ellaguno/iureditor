import { load } from '@tauri-apps/plugin-store';

// Sesión de pestañas: qué archivos estaban abiertos y cuál era el activo,
// para restaurarlos al arrancar. Los "Sin título" no viajan aquí — de esos
// se ocupa el autoguardado de borradores (autosave.ts) cuando están sucios.

const STORE_FILE = 'session.json';
const KEY = 'openTabs';

export interface SessionState {
  paths: string[];
  activePath: string | null;
  /** Carpeta de trabajo del panel de archivos (null = sin carpeta). */
  workspace?: string | null;
  /** Último directorio usado (abrir/guardar/selección en el panel). Es el
   *  destino por defecto de los diálogos; se persiste para que la app no
   *  arranque apuntando al home tras reiniciar. */
  lastDir?: string | null;
  /** Posición del cursor por ruta, para reabrir donde se quedó el usuario:
   *  offset de texto en pestañas de texto plano, posición de ProseMirror en
   *  pestañas markdown. */
  cursors?: Record<string, number>;
}

const getStore = () => load(STORE_FILE, { autoSave: true, defaults: {} });

export const saveSession = async (state: SessionState): Promise<void> => {
  try {
    const store = await getStore();
    await store.set(KEY, state);
  } catch (err) {
    console.error('No se pudo guardar la sesión:', err);
  }
};

export const loadSession = async (): Promise<SessionState | null> => {
  try {
    const store = await getStore();
    const state = await store.get<SessionState>(KEY);
    if (!state || !Array.isArray(state.paths)) return null;
    return {
      paths: state.paths.filter(Boolean),
      activePath: state.activePath ?? null,
      workspace: state.workspace ?? null,
      lastDir: state.lastDir ?? null,
      cursors: state.cursors ?? {},
    };
  } catch {
    return null;
  }
};
