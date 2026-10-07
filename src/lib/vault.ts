// Bóveda activa: la carpeta de notas contra la que se resuelven los
// wikilinks del documento activo. Mantiene su índice (vaultIndex.ts) al día
// leyendo el disco: escaneo completo al abrirla, refresco incremental por
// fecha de modificación al recuperar el foco, y actualización inmediata de
// lo que la propia app guarda, crea o renombra.
//
// Qué carpeta es la bóveda de un documento:
//  1. la bóveda elegida por el usuario (Abrir carpeta…, «Usar como bóveda»)
//     más profunda que lo contiene;
//  2. si no, el ancestro más cercano con una carpeta `.obsidian` (las bóvedas
//     de Obsidian funcionan tal cual);
//  3. si no, la carpeta del propio documento (con poca profundidad).

import { useSyncExternalStore } from 'react';
import { readDir, readTextFile, stat, exists } from '@tauri-apps/plugin-fs';
import { VaultIndex, normPath } from './vaultIndex';
import { notifyLinks } from './linkContext';
import type { LinkCandidate } from './linkContext';
import { parseWikiInner } from './wikilinks';
import { fuzzyFilter, foldText } from './fuzzy';
import { dirname, isMarkdownPath, normalizeEol } from './fileio';
import { t } from './i18n';

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__']);
const MAX_NOTES = 10000;
const MAX_ATTACHMENTS = 20000;
const MAX_DIRS = 4000;
/** Profundidad para bóvedas explícitas o de Obsidian, y para la carpeta
 *  suelta de un documento (que puede ser el home o Descargas). */
const DEPTH_VAULT = 12;
const DEPTH_LOOSE = 3;
const BATCH = 24;
/** Índices de otras bóvedas que se conservan en memoria (volver es barato). */
const CACHE_SIZE = 3;
const REFRESH_THROTTLE_MS = 3000;

export interface VaultSnapshot {
  root: string | null;
  status: 'idle' | 'scanning' | 'ready';
  /** Cambia con cada modificación del índice. */
  version: number;
  count: number;
  /** Algún tope cortó el escaneo (la carpeta es enorme). */
  truncated: boolean;
}

interface WalkResult {
  notes: string[];
  attachments: string[];
  truncated: boolean;
}

const walk = async (root: string, depthLimit: number, cancelled: () => boolean): Promise<WalkResult> => {
  const notes: string[] = [];
  const attachments: string[] = [];
  let truncated = false;
  let dirsSeen = 0;
  let level = [root];
  for (let depth = 0; level.length && !cancelled(); depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (cancelled()) break;
      if (++dirsSeen > MAX_DIRS) {
        truncated = true;
        break;
      }
      let entries;
      try {
        entries = await readDir(dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const path = `${dir}/${e.name}`;
        if (e.isDirectory) {
          if (SKIP_DIRS.has(e.name)) continue;
          if (depth + 1 < depthLimit) next.push(path);
          else truncated = true;
        } else if (e.isFile) {
          if (isMarkdownPath(e.name)) {
            if (notes.length < MAX_NOTES) notes.push(path);
            else truncated = true;
          } else if (attachments.length < MAX_ATTACHMENTS) {
            attachments.push(path);
          }
        }
      }
    }
    level = next;
  }
  return { notes, attachments, truncated };
};

const mtimeOf = async (path: string): Promise<number | null> => {
  try {
    const info = await stat(path);
    return info.mtime ? new Date(info.mtime).getTime() : 0;
  } catch {
    return null;
  }
};

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

class VaultStore {
  private current: VaultIndex | null = null;
  private depth = DEPTH_VAULT;
  private cache = new Map<string, { index: VaultIndex; depth: number }>();
  private token = 0;
  private lastRefresh = 0;
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: VaultSnapshot = { root: null, status: 'idle', version: 0, count: 0, truncated: false };

  get index(): VaultIndex | null {
    return this.current;
  }

  get root(): string | null {
    return this.current?.root ?? null;
  }

  isReady(): boolean {
    return this.snapshot.status === 'ready';
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): VaultSnapshot => this.snapshot;

  private publish(patch: Partial<VaultSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      root: this.root,
      count: this.current?.size ?? 0,
      version: this.snapshot.version + 1,
    };
    for (const fn of this.listeners) fn();
    notifyLinks();
  }

  /** Cambia la bóveda activa (no hace nada si ya lo es). `loose` = carpeta
   *  suelta de un documento: se indexa con poca profundidad. */
  async setRoot(root: string | null, loose = false): Promise<void> {
    if (!root) {
      if (!this.current) return;
      this.token++;
      this.current = null;
      this.publish({ status: 'idle', truncated: false });
      return;
    }
    const key = normPath(root);
    if (this.current && normPath(this.current.root) === key) return;
    if (this.current) {
      this.cache.set(normPath(this.current.root), { index: this.current, depth: this.depth });
    }
    const cached = this.cache.get(key);
    this.cache.delete(key);
    while (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.current = cached?.index ?? new VaultIndex(root);
    this.depth = cached?.depth ?? (loose ? DEPTH_LOOSE : DEPTH_VAULT);
    this.token++;
    this.lastRefresh = 0;
    this.refreshing = null;
    this.publish({ status: cached ? 'ready' : 'scanning', truncated: false });
    await this.refresh(true);
  }

  /** Relee del disco lo que cambió desde el último escaneo. */
  refresh(force = false): Promise<void> {
    if (!this.current) return Promise.resolve();
    if (this.refreshing) return this.refreshing;
    if (!force && Date.now() - this.lastRefresh < REFRESH_THROTTLE_MS) return Promise.resolve();
    const run = this.doRefresh().finally(() => {
      if (this.refreshing === run) this.refreshing = null;
    });
    this.refreshing = run;
    return run;
  }

  private async doRefresh(): Promise<void> {
    const index = this.current;
    if (!index) return;
    const token = this.token;
    const cancelled = () => token !== this.token;
    this.lastRefresh = Date.now();
    const { notes, attachments, truncated } = await walk(index.root, this.depth, cancelled);
    if (cancelled()) return;
    index.setAttachments(attachments);
    const seen = new Set(notes.map(normPath));
    let changed = false;
    for (const entry of index.all()) {
      if (!seen.has(entry.key)) {
        index.remove(entry.path);
        changed = true;
      }
    }
    const initial = index.size === 0;
    for (let i = 0; i < notes.length; i += BATCH) {
      const batch = notes.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (path) => {
          const mtime = await mtimeOf(path);
          if (mtime === null) return false;
          const prev = index.get(path);
          if (prev && prev.mtime === mtime) return false;
          try {
            index.upsert(path, normalizeEol(await readTextFile(path)), mtime);
            return true;
          } catch {
            return false;
          }
        })
      );
      if (cancelled()) return;
      if (results.some(Boolean)) changed = true;
      // En el primer escaneo de una bóveda grande, publicar por tandas: el
      // autocompletado y los enlaces funcionan antes de terminar.
      if (initial && changed && i % (BATCH * 10) === 0) this.publish({});
      await yieldToUi();
    }
    if (cancelled()) return;
    this.lastRefresh = Date.now();
    if (changed || this.snapshot.status !== 'ready' || this.snapshot.truncated !== truncated) {
      this.publish({ status: 'ready', truncated });
    }
  }

  /** La app escribió `content` en `path` (guardar, crear): al índice ya. */
  async noteWritten(path: string, content: string): Promise<void> {
    const index = this.current;
    if (!index || !isMarkdownPath(path) || !index.contains(path)) return;
    const mtime = (await mtimeOf(path)) ?? Date.now();
    index.upsert(path, normalizeEol(content), mtime);
    this.publish({});
  }

  /** Renombrado hecho por la app: la entrada cambia de ruta. */
  async noteRenamed(oldPath: string, newPath: string): Promise<void> {
    const index = this.current;
    if (!index) return;
    const mtime = (await mtimeOf(newPath)) ?? Date.now();
    index.applyRename(oldPath, newPath, mtime);
    this.publish({});
  }
}

export const vault = new VaultStore();

/** Hook: re-renderiza al cambiar la bóveda o su índice. */
export const useVault = (): VaultSnapshot => useSyncExternalStore(vault.subscribe, vault.getSnapshot);

// ---------- qué carpeta es la bóveda de un documento ----------

const obsidianCache = new Map<string, string | null>();

/** Ancestro más cercano de `dir` con `.obsidian/`, o null. */
const findObsidianRoot = async (dir: string): Promise<string | null> => {
  const visited: string[] = [];
  let cur = dir;
  let found: string | null = null;
  for (let i = 0; i < 15; i++) {
    const key = normPath(cur);
    if (obsidianCache.has(key)) {
      found = obsidianCache.get(key) ?? null;
      break;
    }
    visited.push(key);
    try {
      if (await exists(`${cur}/.obsidian`)) {
        found = cur;
        break;
      }
    } catch {
      break; // fuera del alcance de lectura (por encima del home)
    }
    const parent = dirname(cur);
    if (!parent || parent === cur) break;
    cur = parent;
  }
  for (const key of visited) obsidianCache.set(key, found);
  return found;
};

/** Bóveda de un documento. `loose` = no hay bóveda: es su carpeta. */
export const resolveVaultRoot = async (
  docPath: string,
  explicitRoots: string[]
): Promise<{ root: string; loose: boolean }> => {
  const dir = dirname(docPath);
  const key = normPath(dir);
  const explicit = explicitRoots
    .filter((r) => {
      const rk = normPath(r);
      return key === rk || key.startsWith(`${rk}/`);
    })
    .sort((a, b) => b.length - a.length)[0];
  if (explicit) return { root: explicit, loose: false };
  const obsidian = await findObsidianRoot(dir);
  if (obsidian) return { root: obsidian, loose: false };
  return { root: dir, loose: true };
};

// ---------- autocompletado de `[[` ----------

const MAX_SUGGESTIONS = 30;

export const suggestLinks = (query: string, sourcePath: string | null): LinkCandidate[] => {
  const index = vault.index;
  const parts = parseWikiInner(query);
  if (query.includes('|')) {
    // Alias en curso: se inserta tal cual.
    return [{ kind: 'note', label: query.replace(/\\?\|/, ' | '), parts }];
  }
  if (query.includes('#')) {
    const target = parts.target ? index?.resolve(parts.target, sourcePath) ?? null : sourcePath;
    const headings = target ? index?.headingsOf(target) ?? [] : [];
    return fuzzyFilter(headings, parts.heading, (h) => h, { limit: MAX_SUGGESTIONS }).map((h) => ({
      kind: 'heading' as const,
      label: h,
      detail: parts.target || undefined,
      parts: { target: parts.target, heading: h, alias: '' },
    }));
  }
  const notes = index ? fuzzyFilter(index.all(), parts.target, (n) => n.name, {
    secondary: (n) => n.rel,
    limit: MAX_SUGGESTIONS,
  }) : [];
  const items: LinkCandidate[] = notes.map((n) => ({
    kind: 'note',
    label: n.name,
    detail: n.rel.includes('/') ? n.rel : undefined,
    parts: { target: index!.linkTextFor(n.path, sourcePath), heading: '', alias: '' },
  }));
  const typed = parts.target.trim();
  if (typed && !notes.some((n) => foldText(n.name) === foldText(typed))) {
    items.push({
      kind: 'new',
      label: t('wikilink.create', { name: typed }),
      parts: { target: typed, heading: '', alias: '' },
    });
  }
  return items;
};
