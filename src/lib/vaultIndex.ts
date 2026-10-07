// Índice en memoria de una bóveda (carpeta de notas): qué notas hay, sus
// encabezados y sus enlaces salientes. Sobre él se resuelven los wikilinks,
// se calculan backlinks y menciones sin enlazar, y se planifica el
// renombrado. Módulo puro: la lectura del disco vive en vault.ts.

import {
  scanLinks,
  isNotePath,
  formatWikiLink,
  retargetMdLink,
  rewriteLinks,
  encodeLinkPath,
} from './wikilinks';
import type { LinkOccurrence } from './wikilinks';
import { foldText } from './fuzzy';
import { joinAndNormalize } from '../extensions/imageResolve';
import { relativeFrom } from './imageRefs';

export interface NoteEntry {
  /** Ruta tal como se usa para abrir el archivo. */
  path: string;
  /** Ruta normalizada (separador `/`): clave del índice. */
  key: string;
  /** Ruta relativa a la raíz de la bóveda, con extensión. */
  rel: string;
  /** Nombre sin extensión. */
  name: string;
  mtime: number;
  content: string;
  links: LinkOccurrence[];
  headings: string[];
}

export interface Backlink {
  source: NoteEntry;
  /** Enlaces de `source` que apuntan a la nota. */
  links: LinkOccurrence[];
}

export interface Mention {
  source: NoteEntry;
  lines: { line: number; text: string }[];
}

export interface RenameEdit {
  /** Nota cuyo contenido cambia. */
  path: string;
  /** Contenido nuevo y número de enlaces reescritos. */
  content: string;
  count: number;
}

export const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

const dirOf = (key: string): string => {
  const i = key.lastIndexOf('/');
  return i > 0 ? key.slice(0, i) : key;
};

const baseOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1);

export const stripNoteExt = (s: string): string => s.replace(/\.(md|markdown)$/i, '');

/** Encabezados ATX fuera de bloques de código. */
export const extractHeadings = (content: string): string[] => {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of content.split('\n')) {
    const f = /^[ \t]*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (h) out.push(h[1].trim());
  }
  return out;
};

const MENTION_MAX_LINES = 5;
const MENTION_MIN_NAME = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class VaultIndex {
  readonly root: string;
  private readonly rootKey: string;
  private notes = new Map<string, NoteEntry>();
  /** Nombre plegado (sin extensión) → claves de notas. */
  private byName = new Map<string, Set<string>>();
  /** Ruta relativa plegada (sin extensión) → clave. */
  private byRel = new Map<string, string>();
  /** Nombre de archivo plegado (con extensión) → rutas de adjuntos. */
  private attachments = new Map<string, string[]>();

  constructor(root: string) {
    this.root = root;
    this.rootKey = normPath(root);
  }

  get size(): number {
    return this.notes.size;
  }

  all(): NoteEntry[] {
    return [...this.notes.values()];
  }

  get(path: string): NoteEntry | undefined {
    return this.notes.get(normPath(path));
  }

  /** ¿La ruta cuelga de la raíz de la bóveda? */
  contains(path: string): boolean {
    const key = normPath(path);
    return key === this.rootKey || key.startsWith(`${this.rootKey}/`);
  }

  relOf(path: string): string {
    const key = normPath(path);
    return key.startsWith(`${this.rootKey}/`) ? key.slice(this.rootKey.length + 1) : baseOf(key);
  }

  upsert(path: string, content: string, mtime: number): NoteEntry {
    const key = normPath(path);
    this.removeKey(key);
    const entry: NoteEntry = {
      path,
      key,
      rel: this.relOf(path),
      name: stripNoteExt(baseOf(key)),
      mtime,
      content,
      links: scanLinks(content),
      headings: extractHeadings(content),
    };
    this.notes.set(key, entry);
    const name = foldText(entry.name);
    if (!this.byName.has(name)) this.byName.set(name, new Set());
    this.byName.get(name)!.add(key);
    this.byRel.set(foldText(stripNoteExt(entry.rel)), key);
    return entry;
  }

  remove(path: string): void {
    this.removeKey(normPath(path));
  }

  private removeKey(key: string): void {
    const prev = this.notes.get(key);
    if (!prev) return;
    this.notes.delete(key);
    this.byRel.delete(foldText(stripNoteExt(prev.rel)));
    const set = this.byName.get(foldText(prev.name));
    set?.delete(key);
    if (set && !set.size) this.byName.delete(foldText(prev.name));
  }

  setAttachments(paths: string[]): void {
    this.attachments.clear();
    for (const p of paths) {
      const name = foldText(baseOf(normPath(p)));
      const list = this.attachments.get(name) ?? [];
      list.push(p);
      this.attachments.set(name, list);
    }
  }

  /** Elige entre varias notas con el mismo nombre: la de la carpeta de la
   *  nota origen y, si no, la de ruta más corta. */
  private pick(keys: Iterable<string>, sourceKey: string | null): string | null {
    const list = [...keys];
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const dir = sourceKey ? dirOf(sourceKey) : null;
    const same = dir ? list.find((k) => dirOf(k) === dir) : undefined;
    if (same) return same;
    return list.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  /** Ruta (clave) de la nota a la que apunta un wikilink desde `sourcePath`,
   *  o null si no existe. `target` vacío = la propia nota. */
  resolveKey(target: string, sourcePath: string | null): string | null {
    const sourceKey = sourcePath ? normPath(sourcePath) : null;
    if (!target) return sourceKey;
    const tnorm = normPath(target.trim()).replace(/^\.\//, '');
    const noExt = stripNoteExt(tnorm);

    // ¿Adjunto? (`[[plano.pdf]]`, `![[foto.png]]`). Un nombre de nota con
    // punto («v1.2») cae al caso de nota si no hay adjunto con ese nombre.
    if (noExt === tnorm && /\.[A-Za-z0-9]{1,5}$/.test(tnorm)) {
      const list = this.attachments.get(foldText(baseOf(tnorm)));
      if (list?.length) return normPath(this.pickPath(list, sourceKey));
    }

    if (tnorm.includes('/')) {
      const folded = foldText(noExt);
      // 1) relativa a la raíz de la bóveda (forma de Obsidian)
      // 2) relativa a la carpeta de la nota origen
      // 3) sufijo de ruta (`sub/Nota` encuentra `a/b/sub/Nota.md`)
      const exact = this.byRel.get(folded);
      if (exact) return exact;
      if (sourceKey) {
        const abs = normPath(joinAndNormalize(dirOf(sourceKey), noExt));
        const hit = this.contains(abs) ? this.byRel.get(foldText(this.relOf(abs))) : undefined;
        if (hit) return hit;
      }
      const suffix = [...this.notes.values()]
        .filter((n) => foldText(stripNoteExt(n.rel)).endsWith(`/${folded}`))
        .map((n) => n.key);
      return this.pick(suffix, sourceKey);
    }
    const keys = this.byName.get(foldText(noExt));
    return keys ? this.pick(keys, sourceKey) : null;
  }

  private pickPath(paths: string[], sourceKey: string | null): string {
    const byKey = new Map(paths.map((p) => [normPath(p), p] as const));
    return byKey.get(this.pick(byKey.keys(), sourceKey) ?? '') ?? paths[0];
  }

  /** Ruta abrible de la nota/adjunto a la que apunta un wikilink. */
  resolve(target: string, sourcePath: string | null): string | null {
    const key = this.resolveKey(target, sourcePath);
    if (!key) return null;
    const note = this.notes.get(key);
    if (note) return note.path;
    for (const list of this.attachments.values()) {
      const hit = list.find((p) => normPath(p) === key);
      if (hit) return hit;
    }
    return null;
  }

  /** Clave a la que apunta una ocurrencia (wiki o markdown) desde `source`. */
  private occTarget(occ: LinkOccurrence, sourceKey: string): string | null {
    if (occ.kind === 'wiki') return this.resolveKey(occ.target, sourceKey);
    return normPath(joinAndNormalize(dirOf(sourceKey), occ.target));
  }

  /** Texto de enlace más corto que resuelve a `path` desde `sourcePath`: el
   *  nombre si no es ambiguo; si no, la ruta relativa a la bóveda. */
  linkTextFor(path: string, sourcePath: string | null): string {
    const key = normPath(path);
    const name = stripNoteExt(baseOf(key));
    if (this.resolveKey(name, sourcePath) === key) return name;
    return stripNoteExt(this.relOf(path));
  }

  headingsOf(path: string): string[] {
    return this.get(path)?.headings ?? [];
  }

  /** Notas que enlazan a `path` (sin contar los autoenlaces). */
  backlinks(path: string): Backlink[] {
    const key = normPath(path);
    const out: Backlink[] = [];
    for (const note of this.notes.values()) {
      if (note.key === key) continue;
      const links = note.links.filter((occ) => this.occTarget(occ, note.key) === key);
      if (links.length) out.push({ source: note, links });
    }
    return out.sort((a, b) => a.source.rel.localeCompare(b.source.rel));
  }

  /** Enlaces salientes de un texto (la nota `sourcePath`), resueltos. */
  outgoing(
    sourcePath: string,
    content?: string
  ): { occ: LinkOccurrence; path: string | null }[] {
    const sourceKey = normPath(sourcePath);
    const links = content !== undefined ? scanLinks(content) : this.get(sourcePath)?.links ?? [];
    return links.map((occ) => {
      const key = this.occTarget(occ, sourceKey);
      const path = key
        ? this.notes.get(key)?.path ?? (occ.kind === 'wiki' ? this.resolve(occ.target, sourcePath) : null)
        : null;
      return { occ, path };
    });
  }

  /** Notas que mencionan el nombre de `path` como texto, sin enlazarlo. */
  unlinkedMentions(path: string): Mention[] {
    const key = normPath(path);
    const name = stripNoteExt(baseOf(key));
    if (name.length < MENTION_MIN_NAME) return [];
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(foldText(name))}(?=$|[^\\p{L}\\p{N}])`, 'u');
    const out: Mention[] = [];
    for (const note of this.notes.values()) {
      if (note.key === key) continue;
      // Los enlaces (a cualquier nota) se tapan: dentro de ellos el nombre
      // ya está enlazado o es otra cosa.
      let masked = note.content;
      for (const occ of note.links) {
        masked = masked.slice(0, occ.start) + ' '.repeat(occ.end - occ.start) + masked.slice(occ.end);
      }
      const lines: { line: number; text: string }[] = [];
      const src = note.content.split('\n');
      masked.split('\n').forEach((line, i) => {
        if (lines.length < MENTION_MAX_LINES && re.test(foldText(line))) {
          lines.push({ line: i + 1, text: src[i].trim().slice(0, 200) });
        }
      });
      if (lines.length) out.push({ source: note, lines });
    }
    return out.sort((a, b) => a.source.rel.localeCompare(b.source.rel));
  }

  // ---------- renombrado ----------

  /** Destino nuevo de un wikilink de `sourcePath` si hoy apunta a `oldPath`
   *  (null si apunta a otra cosa). Conserva el estilo: nombre a secas si
   *  sigue sin ser ambiguo, ruta si el original era ruta o el nombre nuevo
   *  ya existe en otra carpeta, y la extensión `.md` si la llevaba. Usa el
   *  índice ANTES del renombrado. */
  renamedWikiTarget(target: string, sourcePath: string, oldPath: string, newPath: string): string | null {
    if (!target) return null; // [[#Sección]]: la propia nota
    const oldKey = normPath(oldPath);
    if (this.resolveKey(target, sourcePath) !== oldKey) return null;
    const newName = stripNoteExt(baseOf(normPath(newPath)));
    const others = this.byName.get(foldText(newName));
    const nameIsUnique = !others || [...others].every((k) => k === oldKey);
    const newRel = this.relOf(newPath);
    const base = target.includes('/') || !nameIsUnique ? stripNoteExt(newRel) : newName;
    const ext = /\.(md|markdown)$/i.test(target) ? newRel.slice(stripNoteExt(newRel).length) : '';
    return `${base}${ext}`;
  }

  /** href nuevo de un enlace markdown de `sourcePath` si hoy apunta a
   *  `oldPath` (null si no). Conserva el ancla. */
  renamedMdHref(href: string, sourcePath: string, oldPath: string, newPath: string): string | null {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;
    const hash = href.indexOf('#');
    const rawPath = hash >= 0 ? href.slice(0, hash) : href;
    let decoded = rawPath;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      /* ruta con % literal */
    }
    if (!isNotePath(decoded)) return null;
    const sourceKey = normPath(sourcePath);
    if (normPath(joinAndNormalize(dirOf(sourceKey), decoded)) !== normPath(oldPath)) return null;
    const rel = relativeFrom(dirOf(sourceKey), normPath(newPath)) ?? newPath;
    return `${encodeLinkPath(rel)}${hash >= 0 ? href.slice(hash) : ''}`;
  }

  /** Reescribe en `content` (de la nota `sourcePath`) los enlaces que hoy
   *  apuntan a `oldPath` para que apunten a `newPath`. */
  rewriteForRename(
    content: string,
    sourcePath: string,
    oldPath: string,
    newPath: string
  ): { content: string; count: number } {
    let count = 0;
    const next = rewriteLinks(content, (occ, raw) => {
      if (occ.kind === 'md') {
        const sourceKey = normPath(sourcePath);
        if (normPath(joinAndNormalize(dirOf(sourceKey), occ.target)) !== normPath(oldPath)) return null;
        count++;
        return retargetMdLink(raw, relativeFrom(dirOf(sourceKey), normPath(newPath)) ?? newPath);
      }
      const target = this.renamedWikiTarget(occ.target, sourcePath, oldPath, newPath);
      if (target === null) return null;
      count++;
      return formatWikiLink(
        { target, heading: occ.heading, alias: occ.alias },
        { embed: occ.embed, aliasSep: occ.aliasSep }
      );
    });
    return { content: next, count };
  }

  /** Ediciones necesarias en las notas del índice para renombrar `oldPath`. */
  planRename(oldPath: string, newPath: string): RenameEdit[] {
    const oldKey = normPath(oldPath);
    const edits: RenameEdit[] = [];
    for (const note of this.notes.values()) {
      if (!note.links.length) continue;
      const touches = note.links.some(
        (occ) => !(occ.kind === 'wiki' && !occ.target) && this.occTarget(occ, note.key) === oldKey
      );
      if (!touches) continue;
      const { content, count } = this.rewriteForRename(note.content, note.path, oldPath, newPath);
      if (count) edits.push({ path: note.path, content, count });
    }
    return edits;
  }

  /** Aplica el renombrado al índice (la entrada cambia de ruta). */
  applyRename(oldPath: string, newPath: string, mtime: number): void {
    const prev = this.get(oldPath);
    if (!prev) return;
    this.remove(oldPath);
    if (isNotePath(newPath)) this.upsert(newPath, prev.content, mtime);
  }
}
