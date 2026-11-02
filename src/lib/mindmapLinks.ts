// «Mapa de enlaces»: un mapa mental generado desde el índice de la bóveda. La
// nota está en el centro, sus enlaces son las ramas, los enlaces de esas notas
// las subramas, y una rama aparte reúne las notas que la enlazan. Sale como
// markdown de un callout `[!MINDMAP]` normal: una foto que luego se edita
// como cualquier otro mapa. Módulo puro (recibe el índice).

import type { VaultIndex } from './vaultIndex';
import { normPath, stripNoteExt } from './vaultIndex';
import { formatWikiLink } from './wikilinks';

export interface LinkMapOptions {
  /** Ramas de primer nivel como máximo. */
  maxBranches?: number;
  /** Subramas por rama como máximo. */
  maxSub?: number;
  /** Título de la rama de notas que enlazan aquí. */
  backlinksLabel: string;
}

/** Notas (rutas, sin repetir) a las que enlaza `sourcePath` en `content`. */
const linkedNotes = (index: VaultIndex, sourcePath: string, content?: string): string[] => {
  const self = normPath(sourcePath);
  const seen = new Set<string>([self]);
  const out: string[] = [];
  for (const { path } of index.outgoing(sourcePath, content)) {
    if (!path || !index.get(path)) continue; // rotos y adjuntos fuera
    const key = normPath(path);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
};

/**
 * Markdown del mapa de enlaces de la nota `sourcePath`. `content` es su texto
 * actual (lo que hay en el editor, guardado o no); las notas enlazadas se leen
 * del índice.
 */
export const buildLinkMap = (
  index: VaultIndex,
  sourcePath: string,
  content: string,
  { maxBranches = 20, maxSub = 8, backlinksLabel }: LinkMapOptions
): string => {
  const self = normPath(sourcePath);
  const link = (path: string) =>
    formatWikiLink({ target: index.linkTextFor(path, sourcePath), heading: '', alias: '' });
  const lines = [`> [!MINDMAP] ${stripNoteExt(sourcePath.split(/[\\/]/).pop() ?? '')}`];

  for (const path of linkedNotes(index, sourcePath, content).slice(0, maxBranches)) {
    lines.push(`> - ${link(path)}`);
    const subs = linkedNotes(index, path).filter((p) => normPath(p) !== self);
    for (const sub of subs.slice(0, maxSub)) lines.push(`>   - ${link(sub)}`);
  }

  const back = index.backlinks(sourcePath).slice(0, maxSub * 2);
  if (back.length) {
    lines.push(`> - ${backlinksLabel}`);
    for (const b of back) lines.push(`>   - ${link(b.source.path)}`);
  }
  return lines.join('\n');
};
