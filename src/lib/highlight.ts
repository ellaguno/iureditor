// Resaltado de sintaxis para la vista fuente. Usa el core de highlight.js con
// un conjunto acotado de lenguajes (los mismos que ya trae lowlight vía
// `common`, así Rollup los deduplica y no crecen el bundle).
import hljs from 'highlight.js/lib/core';
import markdown from 'highlight.js/lib/languages/markdown';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import ini from 'highlight.js/lib/languages/ini';

hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('css', css);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('python', python);
hljs.registerLanguage('ini', ini);

// Extensión de archivo → lenguaje registrado (null = sin resaltado).
const EXT_LANG: Record<string, string> = {
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  py: 'python',
  ini: 'ini',
  toml: 'ini',
  cfg: 'ini',
  conf: 'ini',
};

/** Lenguaje de resaltado para una ruta/archivo, o null si no se soporta. */
export const languageForPath = (path: string | null): string | null => {
  if (!path) return 'markdown';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? null;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Resalta `code` en el lenguaje dado y devuelve HTML (spans .hljs-*). Si el
 *  lenguaje es null o desconocido, devuelve el texto escapado sin resaltar. */
export const highlightCode = (code: string, language: string | null): string => {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
};

/**
 * Parte HTML resaltado en líneas (una por `\n` del texto original). Los spans
 * de highlight.js pueden cruzar saltos de línea (p. ej. un bloque de código
 * dentro de markdown): al cortar se cierran los abiertos y se reabren al
 * inicio de la línea siguiente, para que cada línea sea HTML bien formado.
 * Sólo maneja `<span>` (lo único que emiten hljs y la búsqueda).
 */
export const splitHighlightedLines = (html: string): string[] => {
  const stack: string[] = []; // etiquetas de apertura vigentes
  const lines: string[] = [];
  let current = '';
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '<') {
      const close = html.indexOf('>', i);
      const end = close === -1 ? html.length : close + 1;
      const tag = html.slice(i, end);
      if (tag[1] === '/') stack.pop();
      else stack.push(tag);
      current += tag;
      i = end;
    } else if (ch === '\n') {
      lines.push(current + '</span>'.repeat(stack.length));
      current = stack.join('');
      i++;
    } else {
      current += ch;
      i++;
    }
  }
  lines.push(current);
  return lines;
};
