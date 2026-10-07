// Coincidencia difusa para el selector rápido, la paleta de comandos y el
// autocompletado de `[[`: las letras de la consulta deben aparecer en orden
// (no necesariamente juntas). Premia inicios de palabra, letras contiguas y
// coincidencias en el nombre del archivo frente a las de la carpeta.

/** Minúsculas y sin acentos: «canción» encuentra «cancion» y viceversa. */
export const foldText = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const isBoundary = (prev: string | undefined): boolean =>
  prev === undefined || /[\s/\\_\-.()[\]]/.test(prev);

/** Puntuación de `query` dentro de `text` (mayor es mejor), o null si no
 *  coincide. Consulta vacía = 0 (todo coincide). */
export const fuzzyScore = (query: string, text: string): number | null => {
  const q = foldText(query).replace(/\s+/g, '');
  if (!q) return 0;
  const s = foldText(text);
  // Subcadena exacta: siempre gana a una coincidencia dispersa.
  const direct = s.indexOf(q);
  if (direct >= 0) {
    return 1000 - direct + (isBoundary(s[direct - 1]) ? 200 : 0) - (s.length - q.length);
  }
  let score = 0;
  let si = 0;
  let prevMatch = -2;
  for (const ch of q) {
    const found = s.indexOf(ch, si);
    if (found < 0) return null;
    if (found === prevMatch + 1) score += 15;
    if (isBoundary(s[found - 1])) score += 10;
    score -= Math.min(found - si, 10);
    prevMatch = found;
    si = found + 1;
  }
  return score - (s.length - q.length) * 0.1;
};

/** Filtra y ordena `items` por la puntuación de `key(item)`. Si `secondary`
 *  está presente, también se busca ahí (con menos peso): p. ej. el nombre
 *  del archivo como clave y la ruta completa como respaldo. */
export const fuzzyFilter = <T>(
  items: T[],
  query: string,
  key: (item: T) => string,
  opts: { secondary?: (item: T) => string; limit?: number } = {}
): T[] => {
  if (!query.trim()) return opts.limit ? items.slice(0, opts.limit) : items.slice();
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const primary = fuzzyScore(query, key(item));
    const second = opts.secondary ? fuzzyScore(query, opts.secondary(item)) : null;
    const best =
      primary !== null && second !== null
        ? Math.max(primary + 50, second)
        : primary !== null
          ? primary + 50
          : second;
    if (best !== null) scored.push({ item, score: best });
  }
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.map((x) => x.item);
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
};
