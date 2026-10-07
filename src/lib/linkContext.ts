// Punto de encuentro entre los wikilinks del editor y la app: la extensión de
// TipTap pregunta aquí si un enlace resuelve, qué sugerir al escribir `[[` y
// qué hacer al hacer clic; la app (vía vault.ts) registra las respuestas.
// Sin dependencias de Tauri para que el editor siga siendo testeable.

import type { WikiParts } from './wikilinks';

export interface LinkCandidate {
  kind: 'note' | 'heading' | 'new';
  label: string;
  /** Texto secundario (la ruta dentro de la bóveda). */
  detail?: string;
  parts: WikiParts;
}

export interface LinkContext {
  /** ¿El índice ya está cargado? Antes de eso ningún enlace se marca roto. */
  ready: () => boolean;
  /** Ruta a la que apunta el enlace, o null si no existe. */
  resolve: (target: string, sourcePath: string | null) => string | null;
  /** Sugerencias para el texto escrito tras `[[`. */
  suggest: (query: string, sourcePath: string | null) => LinkCandidate[];
  /** Clic en un enlace. */
  open: (parts: WikiParts, sourcePath: string | null) => void;
}

let context: LinkContext | null = null;
const listeners = new Set<() => void>();

export const setLinkContext = (ctx: LinkContext | null): void => {
  context = ctx;
  notifyLinks();
};

export const getLinkContext = (): LinkContext | null => context;

/** Avisa a los enlaces visibles de que el índice cambió (se re-pintan). */
export const notifyLinks = (): void => {
  for (const fn of listeners) fn();
};

export const subscribeLinks = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
