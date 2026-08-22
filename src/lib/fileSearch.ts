// Búsqueda de texto en los archivos de la carpeta de trabajo (panel lateral,
// Ctrl+Shift+F). Recorre el árbol en anchura con los mismos criterios que el
// panel de archivos (sin carpetas ocultas, sólo markdown/texto) y busca el
// término sin distinguir mayúsculas. Con topes de profundidad, archivos y
// resultados para que una carpeta enorme no congele la interfaz.

import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { isMarkdownPath, isTextPath } from './fileio';

export interface FileMatch {
  /** Línea 1-based dentro del archivo. */
  line: number;
  /** Contenido de la línea (recortado para la lista de resultados). */
  text: string;
}

export interface FileResult {
  path: string;
  /** Ruta relativa a la carpeta de trabajo, para mostrar. */
  relative: string;
  matches: FileMatch[];
}

export interface SearchOutcome {
  results: FileResult[];
  /** true si algún tope cortó la búsqueda (hay más resultados). */
  truncated: boolean;
}

/** Señal de cancelación: el panel la marca cuando el usuario relanza. */
export interface CancelToken {
  cancelled: boolean;
}

const MAX_DEPTH = 8;
const MAX_FILES = 2000;
const MAX_TOTAL_MATCHES = 400;
const MAX_MATCHES_PER_FILE = 50;
const MAX_LINE_PREVIEW = 200;
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build']);

const searchableFile = (name: string): boolean =>
  isMarkdownPath(name) || (isTextPath(name) && name.includes('.'));

export const searchInFiles = async (
  root: string,
  term: string,
  token: CancelToken
): Promise<SearchOutcome> => {
  const needle = term.toLowerCase();
  const results: FileResult[] = [];
  let truncated = false;
  let filesSeen = 0;
  let totalMatches = 0;

  // BFS por niveles: los archivos cercanos a la raíz aparecen primero.
  let level: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (level.length > 0 && !token.cancelled && totalMatches < MAX_TOTAL_MATCHES) {
    const next: typeof level = [];
    for (const { dir, depth } of level) {
      if (token.cancelled) break;
      let entries;
      try {
        entries = await readDir(dir);
      } catch {
        continue; // sin permiso o desapareció: se ignora
      }
      for (const entry of entries) {
        if (token.cancelled) break;
        if (entry.name.startsWith('.')) continue;
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          if (depth + 1 <= MAX_DEPTH && !SKIP_DIRS.has(entry.name)) {
            next.push({ dir: path, depth: depth + 1 });
          } else if (depth + 1 > MAX_DEPTH) {
            truncated = true;
          }
          continue;
        }
        if (!searchableFile(entry.name)) continue;
        if (totalMatches >= MAX_TOTAL_MATCHES) continue;
        if (++filesSeen > MAX_FILES) {
          truncated = true;
          continue;
        }
        let content: string;
        try {
          content = await readTextFile(path);
        } catch {
          continue; // binario o ilegible
        }
        const matches: FileMatch[] = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].toLowerCase().includes(needle)) continue;
          if (matches.length >= MAX_MATCHES_PER_FILE || totalMatches >= MAX_TOTAL_MATCHES) {
            truncated = true;
            break;
          }
          matches.push({ line: i + 1, text: lines[i].trim().slice(0, MAX_LINE_PREVIEW) });
          totalMatches++;
        }
        if (matches.length > 0) {
          const relative = path.startsWith(root)
            ? path.slice(root.length).replace(/^[/\\]/, '')
            : path;
          results.push({ path, relative, matches });
        }
        if (totalMatches >= MAX_TOTAL_MATCHES) truncated = true;
      }
    }
    level = next;
  }

  return { results, truncated };
};
