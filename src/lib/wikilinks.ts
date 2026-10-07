// Enlaces entre notas: wikilinks estilo Obsidian (`[[Nota]]`, `[[Nota#Sección]]`,
// `[[Nota|alias]]`, `![[Nota]]`) y enlaces markdown a otros `.md`
// (`[texto](otra.md#ancla)`). Módulo puro (sin Tauri ni DOM): lo usan el
// índice de la bóveda, el renombrado (reescritura de enlaces) y el parser.

/** Partes de un wikilink. `target` vacío = enlace a una sección de la propia
 *  nota (`[[#Sección]]`). */
export interface WikiParts {
  target: string;
  heading: string;
  alias: string;
}

/** Ocurrencia de un enlace dentro del texto markdown. */
export interface LinkOccurrence {
  kind: 'wiki' | 'md';
  /** Offsets en el texto original: `text.slice(start, end)` es el enlace. */
  start: number;
  end: number;
  /** Línea 1-based. */
  line: number;
  /** `![[…]]` (incrustación). Sólo wikilinks. */
  embed: boolean;
  /** wiki: texto del enlace (`carpeta/Nota`); md: ruta decodificada (`../a.md`). */
  target: string;
  /** Sección (`#…`) sin el `#`. */
  heading: string;
  /** wiki: alias; md: el texto visible del enlace. */
  alias: string;
  /** Separador de alias usado (`\|` dentro de tablas). Sólo wikilinks. */
  aliasSep: '|' | '\\|';
}

/** Un wikilink: `[[…]]` sin corchetes ni saltos dentro. El `!` opcional
 *  delante es una incrustación. */
export const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

/** Enlace markdown inline. Las imágenes (`![…](…)`) se descartan después. */
const MD_LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** `Nota#Sección|alias` → partes. Acepta `\|` (forma escapada dentro de tablas). */
export const parseWikiInner = (inner: string): WikiParts & { aliasSep: '|' | '\\|' } => {
  let body = inner;
  let alias = '';
  let aliasSep: '|' | '\\|' = '|';
  const esc = body.indexOf('\\|');
  const bar = body.indexOf('|');
  if (esc >= 0 && esc < bar) {
    alias = body.slice(esc + 2);
    body = body.slice(0, esc);
    aliasSep = '\\|';
  } else if (bar >= 0) {
    alias = body.slice(bar + 1);
    body = body.slice(0, bar);
  }
  const hash = body.indexOf('#');
  const target = (hash >= 0 ? body.slice(0, hash) : body).trim();
  const heading = hash >= 0 ? body.slice(hash + 1).trim() : '';
  return { target, heading, alias: alias.trim(), aliasSep };
};

/** Partes → `[[…]]`. */
export const formatWikiLink = (
  parts: WikiParts,
  opts: { embed?: boolean; aliasSep?: '|' | '\\|' } = {}
): string => {
  const sep = opts.aliasSep ?? '|';
  return `${opts.embed ? '!' : ''}[[${parts.target}${parts.heading ? `#${parts.heading}` : ''}${
    parts.alias ? `${sep}${parts.alias}` : ''
  }]]`;
};

/** Texto visible de un wikilink en el editor: el alias o `Nota › Sección`. */
export const wikiDisplay = (parts: WikiParts): string => {
  if (parts.alias) return parts.alias;
  if (!parts.target) return parts.heading;
  return parts.heading ? `${parts.target} › ${parts.heading}` : parts.target;
};

// ---------- tramos que no son prosa ----------

/** Rangos [inicio, fin) donde un `[[x]]` es texto literal: front matter,
 *  bloques de código vallados y spans de código. */
const literalRanges = (text: string): [number, number][] => {
  const ranges: [number, number][] = [];
  const fm = /^﻿?---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  if (fm) ranges.push([0, fm[0].length]);
  const patterns = [
    /^[ \t]*(```+|~~~+)[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm,
    /`+[^`\n]*`+/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
};

const inRanges = (ranges: [number, number][], offset: number): boolean =>
  ranges.some(([s, e]) => offset >= s && offset < e);

/** Línea 1-based de cada offset (búsqueda binaria sobre los inicios de línea). */
const lineIndexer = (text: string) => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
};

const hasScheme = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url);

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** ¿La ruta (sin ancla) apunta a una nota markdown? */
export const isNotePath = (path: string): boolean => /\.(md|markdown)$/i.test(path);

/** Todos los enlaces a notas del texto, en orden. Ignora código y front
 *  matter; de los enlaces markdown sólo cuenta los relativos a `.md`. */
export const scanLinks = (text: string): LinkOccurrence[] => {
  const literal = literalRanges(text);
  const lineOf = lineIndexer(text);
  const out: LinkOccurrence[] = [];
  const wikiSpans: [number, number][] = [];

  const wiki = new RegExp(WIKILINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = wiki.exec(text)) !== null) {
    if (inRanges(literal, m.index)) continue;
    const parts = parseWikiInner(m[2]);
    if (!parts.target && !parts.heading) continue;
    wikiSpans.push([m.index, m.index + m[0].length]);
    out.push({
      kind: 'wiki',
      start: m.index,
      end: m.index + m[0].length,
      line: lineOf(m.index),
      embed: m[1] === '!',
      target: parts.target,
      heading: parts.heading,
      alias: parts.alias,
      aliasSep: parts.aliasSep,
    });
  }

  const md = new RegExp(MD_LINK_RE.source, 'g');
  while ((m = md.exec(text)) !== null) {
    if (m[1] === '!' || inRanges(literal, m.index) || inRanges(wikiSpans, m.index)) continue;
    const url = m[3].replace(/^<|>$/g, '');
    if (hasScheme(url) || url.startsWith('#') || url.startsWith('/')) continue;
    const hash = url.indexOf('#');
    const path = safeDecode(hash >= 0 ? url.slice(0, hash) : url);
    if (!isNotePath(path)) continue;
    out.push({
      kind: 'md',
      start: m.index,
      end: m.index + m[0].length,
      line: lineOf(m.index),
      embed: false,
      target: path,
      heading: hash >= 0 ? safeDecode(url.slice(hash + 1)) : '',
      alias: m[2],
      aliasSep: '|',
    });
  }

  return out.sort((a, b) => a.start - b.start);
};

/** Reescribe enlaces: `replace` devuelve el texto nuevo de la ocurrencia, o
 *  null para dejarla intacta. */
export const rewriteLinks = (
  text: string,
  replace: (occ: LinkOccurrence, raw: string) => string | null
): string => {
  const occs = scanLinks(text);
  let out = text;
  for (let i = occs.length - 1; i >= 0; i--) {
    const occ = occs[i];
    const next = replace(occ, text.slice(occ.start, occ.end));
    if (next === null || next === text.slice(occ.start, occ.end)) continue;
    out = out.slice(0, occ.start) + next + out.slice(occ.end);
  }
  return out;
};

/** Ruta de un enlace markdown: espacios y paréntesis codificados (el parser
 *  cortaría el enlace en ellos). */
export const encodeLinkPath = (path: string): string =>
  path.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Texto de un enlace markdown `[alias](ruta#ancla)` reapuntado a `newPath`,
 *  conservando el título si lo había. */
export const retargetMdLink = (raw: string, newPath: string): string =>
  raw.replace(/\]\(([^)\s#]*)(#[^)\s]*)?/, (_m, _old: string, anchor?: string) =>
    `](${encodeLinkPath(newPath)}${anchor ?? ''}`
  );
