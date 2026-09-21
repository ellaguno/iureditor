// Puente con el backend para la integración con Iurefficient (sesión con la
// cuenta, proyectos, documentos espejo y versiones). Las llamadas de red viven
// en Rust (conector común iurefficient-connect); aquí sólo los tipos y los invoke.
import { invoke } from '@tauri-apps/api/core';

export interface IureStatus {
  domain: string;
  email: string;
  loggedIn: boolean;
  name: string | null;
  /** Etiqueta de «proyecto» según la instancia (caso, expediente…). */
  caseLabel: string;
  error: string | null;
}

export interface IureLoginResult {
  loggedIn: boolean;
  requiresTotp: boolean;
  totpToken: string | null;
  name: string | null;
}

export interface IureCase {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  clientName: string | null;
  clientId: string | null;
}

export interface IureRemoteDoc {
  id: string;
  title: string;
  fileName: string;
  /** Markdown o texto: se puede abrir en el editor. */
  editable: boolean;
}

export interface IureMirror {
  caseId: string | null;
  caseTitle: string | null;
  documentId: string;
  fileName: string;
}

export const iure = {
  status: () => invoke<IureStatus>('iure_status'),
  login: (domain: string, email: string, password: string, totpToken?: string, totpCode?: string) =>
    invoke<IureLoginResult>('iure_login', {
      domain,
      email,
      password,
      totpToken: totpToken ?? null,
      totpCode: totpCode ?? null,
    }),
  logout: () => invoke<void>('iure_logout'),
  cases: (query: string) => invoke<IureCase[]>('iure_cases', { query }),
  caseDocuments: (caseId: string) => invoke<IureRemoteDoc[]>('iure_case_documents', { caseId }),
  openDocument: (caseId: string | null, caseTitle: string | null, documentId: string, fileName: string) =>
    invoke<string>('iure_open_document', { caseId, caseTitle, documentId, fileName }),
  mirrorOf: (path: string) => invoke<IureMirror | null>('iure_mirror_of', { path }),
  uploadVersion: (path: string) => invoke<IureMirror>('iure_upload_version', { path }),
  saveNew: (path: string, caseId: string | null, caseTitle: string | null) =>
    invoke<IureMirror>('iure_save_new', { path, caseId, caseTitle }),
};

const AUTOSYNC_KEY = 'iur-iure-autosync';

/** ¿Subir automáticamente una versión al guardar un documento vinculado? */
export const getAutoSync = (): boolean => {
  try {
    return localStorage.getItem(AUTOSYNC_KEY) !== '0';
  } catch {
    return true;
  }
};
export const setAutoSync = (on: boolean): void => {
  try {
    localStorage.setItem(AUTOSYNC_KEY, on ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
};

export interface SyncEvent {
  path: string;
  ok: boolean;
  error?: string;
}

/**
 * Tras guardar en disco: si el archivo está vinculado a un documento de
 * Iurefficient y la sincronización automática está activa, sube una versión.
 * Avisa por un evento del DOM (`iure-synced`) para que el panel lo muestre.
 */
export const syncAfterSave = async (path: string): Promise<void> => {
  if (!getAutoSync()) return;
  let mirror: IureMirror | null = null;
  try {
    mirror = await iure.mirrorOf(path);
  } catch {
    return;
  }
  if (!mirror) return;
  const detail: SyncEvent = { path, ok: true };
  try {
    await iure.uploadVersion(path);
  } catch (e) {
    detail.ok = false;
    detail.error = String(e);
  }
  window.dispatchEvent(new CustomEvent<SyncEvent>('iure-synced', { detail }));
};
