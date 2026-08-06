// Búsqueda para la vista fuente (SourceView). El editor WYSIWYG resuelve esto
// con decoraciones de ProseMirror (extensions/searchReplace.ts), pero la vista
// fuente es un <textarea> transparente sobre un <pre> ya resaltado por
// highlight.js: aquí se buscan las coincidencias sobre el texto plano y se
// inyectan los <span> del resaltado en ese HTML, respetando sus etiquetas.

export interface Match {
  start: number;
  end: number;
}

/** Coincidencias de `term` en `text`, en orden y sin solaparse. */
export const findMatches = (text: string, term: string, caseSensitive: boolean): Match[] => {
  if (!term) return [];
  // Se busca con RegExp en vez de indexOf sobre el texto en minúsculas porque
  // toLowerCase() puede cambiar la longitud (ej. 'İ' → 2 caracteres) y
  // desplazaría todos los índices respecto del texto original.
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
  const out: Match[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
    // Un término que casa vacío colgaría el bucle; imposible con term != ''.
    re.lastIndex = m.index + m[0].length;
  }
  return out;
};

/** ¿En qué coincidencia cae el carácter `i`? (-1 si en ninguna) */
const matchAt = (matches: Match[], i: number): number => {
  for (let k = 0; k < matches.length; k++) {
    if (i < matches[k].start) return -1;
    if (i < matches[k].end) return k;
  }
  return -1;
};

/**
 * Envuelve las coincidencias en el HTML ya resaltado. Recorre el HTML saltando
 * las etiquetas y contando las entidades (`&amp;`) como un solo carácter, para
 * que los índices del texto plano cuadren. Si una coincidencia cruza una
 * etiqueta, se cierra y reabre el span a cada lado en vez de anidar mal.
 */
export const injectSearchMarks = (
  html: string,
  matches: Match[],
  currentIndex: number
): string => {
  if (!matches.length) return html;

  const openTag = (k: number) =>
    `<span class="iur-search-hit${k === currentIndex ? ' iur-search-current' : ''}">`;

  let out = '';
  let open = -1; // coincidencia cuyo span está abierto ahora mismo
  let textIndex = 0;
  let i = 0;

  while (i < html.length) {
    if (html[i] === '<') {
      // Etiqueta: el span no puede cruzarla sin romper el anidamiento.
      const close = html.indexOf('>', i);
      const end = close === -1 ? html.length : close + 1;
      const reopen = open;
      if (open !== -1) {
        out += '</span>';
        open = -1;
      }
      out += html.slice(i, end);
      if (reopen !== -1) {
        out += openTag(reopen);
        open = reopen;
      }
      i = end;
      continue;
    }

    // Una entidad HTML es un único carácter del texto plano.
    let unitEnd = i + 1;
    if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i <= 10) unitEnd = semi + 1;
    }

    const k = matchAt(matches, textIndex);
    if (k !== open) {
      if (open !== -1) out += '</span>';
      if (k !== -1) out += openTag(k);
      open = k;
    }
    out += html.slice(i, unitEnd);
    textIndex++;
    i = unitEnd;
  }

  if (open !== -1) out += '</span>';
  return out;
};

/** Texto resultante de sustituir una coincidencia. */
export const replaceMatch = (text: string, match: Match, replacement: string): string =>
  text.slice(0, match.start) + replacement + text.slice(match.end);

/** Texto resultante de sustituir todas las coincidencias (de atrás hacia
 *  delante, para no invalidar los índices pendientes). */
export const replaceAllMatches = (
  text: string,
  matches: Match[],
  replacement: string
): string => {
  let out = text;
  for (let k = matches.length - 1; k >= 0; k--) out = replaceMatch(out, matches[k], replacement);
  return out;
};
