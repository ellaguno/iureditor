// Referencias a imágenes dentro del markdown: extraerlas, reescribirlas y
// razonar sobre rutas relativas. Módulo puro (sin Tauri) para que la lógica
// que decide a dónde va cada imagen al «guardar como» sea testeable.

/** Las dos formas en que una imagen puede aparecer: markdown `![alt](src)` y
 *  HTML `<img src="…">`. Cada patrón parte el match en prefijo · src · sufijo,
 *  para poder sustituir SÓLO el src sin tocar el alt ni el resto de atributos.
 *  Un único sitio donde viven: extracción y reescritura no pueden divergir. */
const IMG_PATTERNS: RegExp[] = [
  /(!\[[^\]]*\]\(\s*<?)([^)\s>]+)(>?(?:\s+["'][^"']*["'])?\s*\))/g,
  /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
];

/** Tramos de código (vallados ``` y spans `…`) donde un `![x](y)` es un
 *  EJEMPLO, no una imagen: ni se copia ni —sobre todo— se reescribe, que
 *  corrompería el ejemplo de quien está documentando markdown. */
const codeRanges = (content: string): [number, number][] => {
  const ranges: [number, number][] = [];
  const patterns = [
    /^[ \t]{0,3}(```+|~~~+)[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gm,
    /`+[^`\n]*`+/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
};

const inRanges = (ranges: [number, number][], offset: number): boolean =>
  ranges.some(([start, end]) => offset >= start && offset < end);

/** Extrae los `src` de todas las imágenes del contenido, en orden y sin
 *  repetir. Ignora las que aparecen dentro de bloques de código. */
export const extractImageSrcs = (content: string): string[] => {
  const srcs = new Set<string>();
  const code = codeRanges(content);
  for (const pattern of IMG_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (!inRanges(code, m.index)) srcs.add(m[2]);
    }
  }
  return [...srcs];
};

/** ¿El src apunta a un archivo local relativo al documento? (no http(s), no
 *  data:, no asset:, no absoluto) */
export const isRelativeImg = (src: string): boolean =>
  !!src &&
  !/^(?:[a-z]+:)?\/\//i.test(src) &&
  !src.startsWith('data:') &&
  !src.startsWith('asset:') &&
  !src.startsWith('/') &&
  !/^[A-Za-z]:[/\\]/.test(src);

/** Sustituye los `src` indicados por el mapa. Los que no estén en el mapa
 *  quedan intactos. */
export const rewriteImageSrcs = (content: string, rewrites: Map<string, string>): string => {
  if (!rewrites.size) return content;
  let out = content;
  for (const pattern of IMG_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    // Los tramos de código se recalculan por pasada: la anterior pudo cambiar
    // longitudes y con ellas los offsets.
    const code = codeRanges(out);
    out = out.replace(
      re,
      (match, prefix: string, src: string, suffix: string, offset: number) => {
        const next = rewrites.get(src);
        if (next === undefined || inRanges(code, offset)) return match;
        return `${prefix}${next}${suffix}`;
      }
    );
  }
  return out;
};

/** Un src de markdown no puede llevar espacios ni paréntesis sin escapar: el
 *  parser cortaría el enlace. Se percent-codifican al reescribir. */
export const encodeImgSrc = (src: string): string =>
  src.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Inversa de `encodeImgSrc` para resolver el src contra el disco. Devuelve el
 *  original si no está codificado o si el escape es inválido. */
export const decodeImgSrc = (src: string): string => {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
};

// ---------- rutas ----------

const segmentsOf = (p: string): string[] =>
  p.split(/[/\\]/).filter((s) => s !== '' && s !== '.');

/** ¿`abs` cuelga de `dir`? Ambas rutas se esperan ya normalizadas
 *  (`joinAndNormalize`). Comparación exacta de segmentos: en un sistema de
 *  archivos sensible a mayúsculas, `/Docs` y `/docs` son carpetas distintas. */
export const isInsideDir = (dir: string, abs: string): boolean => {
  const base = segmentsOf(dir);
  const target = segmentsOf(abs);
  if (target.length <= base.length) return false;
  return base.every((seg, i) => seg === target[i]);
};

/** Ruta relativa (con `/`) que lleva de `fromDir` a `to`, o null si no
 *  comparten raíz — en Windows, unidades distintas: no hay relativa posible y
 *  quien llame debe quedarse con la absoluta. */
export const relativeFrom = (fromDir: string, to: string): string | null => {
  const from = segmentsOf(fromDir);
  const target = segmentsOf(to);
  if (!from.length || !target.length || from[0] !== target[0]) return null;
  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }
  const up = Array(from.length - common).fill('..');
  const down = target.slice(common);
  return [...up, ...down].join('/') || '.';
};
