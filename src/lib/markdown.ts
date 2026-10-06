import TurndownService from 'turndown';

// Round-trip markdown ↔ HTML para TipTap, portado de Colaborador especialista
// (TipTapEditor.tsx). Cambio principal para iureditor: los bloques ```mermaid
// se convierten en <div data-type="mermaid" data-code="..."> para que la
// extensión Mermaid de TipTap los renderice como diagrama en vivo, y la regla
// inversa de Turndown los devuelve al fence verbatim.

// ¿El contenido es un documento HTML ya renderizado (y por tanto hay que
// saltarse la conversión markdown)?
//
// Sólo devolvemos true cuando el documento EMPIEZA por HTML. Un documento
// markdown que meramente EMBEBE bloques HTML (p.ej. mockups de UI
// `<div style="...">`) debe pasar por markdownToHtml: éste convierte
// encabezados, listas, fences, tablas, etc. y a la vez preserva esos bloques
// HTML verbatim (STEP 7). Antes bastaba con encontrar un `<div>`/`<p>` en
// CUALQUIER punto para clasificar todo el archivo como HTML y no convertir
// nada: el markdown se mostraba crudo (encabezados `#`, fences ``` y mockups)
// como si fuese texto/código.
export const isHtmlContent = (content: string): boolean => {
  const head = content.replace(/^﻿/, '').trimStart();
  return /^(?:<!doctype\b|<(?:html|body|p|div|h[1-6]|ul|ol|table|blockquote|pre|section|article|header|footer|main|figure|img)\b)/i.test(
    head
  );
};

// Divide una fila de tabla en celdas. Un `\|` escapado es un carácter `|`
// literal dentro de la celda (antes partía la celda en dos y el backslash
// quedaba como texto).
const parseTableRow = (line: string): string[] => {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (ch === '|') {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  const trimmed = cells.map(c => c.trim());
  if (/^\s*\|/.test(line)) trimmed.shift();
  if (/\|\s*$/.test(line) && trimmed.length) trimmed.pop();
  return trimmed;
};

// Fila separadora `| --- | :---: |`. Acepta tablas de UNA columna (`| --- |`),
// que el regex anterior rechazaba: la separadora pasaba como fila de datos
// con el texto `---` y la tabla crecía una fila en cada recarga.
const SEP_CELL = /^:?-+:?$/;
const isTableSeparator = (line: string): boolean => {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every(c => SEP_CELL.test(c));
};

type CellAlign = 'left' | 'center' | 'right' | null;
const alignOfSeparator = (cell: string): CellAlign => {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
};

// Las celdas sólo admiten contenido inline en markdown; los bloques (listas,
// párrafos múltiples) viajan como HTML embebido que TipTap parsea
// directamente. Si la celda trae bloques no se envuelve en <p> (el parser
// HTML cerraría el párrafo antes del bloque y dejaría un <p> vacío al final).
const CELL_BLOCK_HTML = /<(?:ul|ol|p|div|pre|blockquote|h[1-6]|table)\b/i;
const tableCellHtml = (tag: 'th' | 'td', content: string, align: CellAlign): string => {
  if (!align || align === 'left' || CELL_BLOCK_HTML.test(content)) {
    return `<${tag}>${content}</${tag}>`;
  }
  return `<${tag}><p style="text-align: ${align}">${content}</p></${tag}>`;
};

// Convert a markdown table block (array of lines) into an HTML <table>
const markdownTableToHtml = (tableLines: string[], isImageAtom: (idx: number) => boolean): string => {
  if (tableLines.length < 2) return tableLines.map(l => `<p>${l}</p>`).join('\n');

  // `texto<br>![img]`: la imagen es un nodo de bloque, así que el <br> que
  // la precede sólo dejaría un salto duro colgando al final del párrafo (una
  // línea vacía visible en la celda y un <br> más en cada guardado).
  const dropBreakBeforeImage = (content: string): string =>
    content.replace(/(?:<br\s*\/?>\s*)+(<!--IUR-ATOM-(\d+)-->)/gi, (m, atom: string, idx: string) =>
      isImageAtom(Number(idx)) ? atom : m
    );

  const headerCells = parseTableRow(tableLines[0]).map(dropBreakBeforeImage);
  const hasSeparator = isTableSeparator(tableLines[1]);
  const aligns: CellAlign[] = hasSeparator ? parseTableRow(tableLines[1]).map(alignOfSeparator) : [];
  const dataStartIndex = hasSeparator ? 2 : 1;
  const dataRows = tableLines
    .slice(dataStartIndex)
    .map(line => parseTableRow(line).map(dropBreakBeforeImage));

  // Todas las filas con el mismo número de columnas: una fila corta se
  // rellena con celdas vacías (TipTap no acepta tablas irregulares).
  const cols = Math.max(headerCells.length, ...dataRows.map(r => r.length));
  const pad = (cells: string[]): string[] =>
    cells.length >= cols ? cells : [...cells, ...Array(cols - cells.length).fill('')];

  let html = '<table><tbody>';

  html += '<tr>';
  pad(headerCells).forEach((cell, i) => {
    html += tableCellHtml('th', cell, aligns[i] ?? null);
  });
  html += '</tr>';

  for (const row of dataRows) {
    html += '<tr>';
    pad(row).forEach((cell, i) => {
      html += tableCellHtml('td', cell, aligns[i] ?? null);
    });
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
};

// Escape HTML entities inside text that will be put in <code> or <pre>
const escapeHtmlForCode = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Escape for use inside a double-quoted HTML attribute
const escapeHtmlAttr = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// ---------- Listas ----------
// Agrupa líneas consecutivas de viñetas / numeradas / tareas y construye
// <ul>/<ol> anidados según la sangría (2+ espacios o tab = un nivel más).
// Un ítem puede tener varios párrafos (línea en blanco + párrafo sangrado) y
// bloques de código sangrados; antes esas líneas partían la lista en dos.

type ListKind = 'ul' | 'ol' | 'task';
interface ListItem {
  kind: ListKind;
  indent: number;
  start?: number; // número del primer ítem de un <ol>
  li: string; // <li> SIN cerrar — las sublistas van dentro
  // Contenido que va DESPUÉS de las sublistas del ítem (párrafo de
  // continuación que pertenece al ítem padre, no al último hijo).
  after: string;
}

const CODEBLOCK_PLACEHOLDER = /^<!--IUR-CODEBLOCK-\d+-->$/;
// Un marcador sin texto (`-`, `1.`, `- [ ]`) es un ítem vacío: así se guardan
// los ítems recién creados sin escribir, y así se recuperan.
const isListLine = (line: string) => /^[ \t]*(?:[-*+]|\d+[.)])(?: |$)/.test(line);
const indentOf = (ws: string): number => ws.replace(/\t/g, '    ').length;

const openListTag = (item: ListItem) =>
  item.kind === 'task'
    ? '<ul data-type="taskList">'
    : item.kind === 'ol'
      ? item.start && item.start !== 1
        ? `<ol start="${item.start}">`
        : '<ol>'
      : '<ul>';
const closeListTag = (kind: ListKind) => (kind === 'ol' ? '</ol>' : '</ul>');

const buildList = (items: ListItem[]): string => {
  const out: string[] = [];
  // Pila de listas abiertas; cada nivel recuerda su <li> abierto para
  // cerrarlo con su cola (`after`) cuando toque.
  const stack: { kind: ListKind; indent: number; open: ListItem | null }[] = [];
  const top = () => stack[stack.length - 1];
  const closeItem = (level: { open: ListItem | null }) => {
    if (level.open) {
      if (level.open.after) out.push(level.open.after);
      out.push('</li>');
      level.open = null;
    }
  };
  for (const item of items) {
    if (stack.length === 0) {
      out.push(openListTag(item));
      stack.push({ kind: item.kind, indent: item.indent, open: null });
    } else if (item.indent > top().indent) {
      // Sublista: se abre dentro del <li> aún sin cerrar.
      out.push(openListTag(item));
      stack.push({ kind: item.kind, indent: item.indent, open: null });
    } else {
      closeItem(top());
      while (stack.length > 1 && item.indent < top().indent) {
        out.push(closeListTag(stack.pop()!.kind));
        closeItem(top());
      }
      if (item.kind !== top().kind) {
        out.push(closeListTag(stack.pop()!.kind));
        out.push(openListTag(item));
        stack.push({ kind: item.kind, indent: item.indent, open: null });
      }
    }
    out.push(item.li);
    top().open = item;
  }
  while (stack.length) {
    const level = stack.pop()!;
    closeItem(level);
    out.push(closeListTag(level.kind));
  }
  return out.join('');
};

const convertLists = (html: string): string => {
  const lines = html.split('\n');
  const out: string[] = [];
  let buffer: ListItem[] = [];
  // Hubo línea en blanco desde el último ítem: la siguiente línea sangrada es
  // un párrafo nuevo del ítem, no la continuación (soft wrap) de su texto.
  let afterBlank = false;

  const flush = () => {
    if (buffer.length) out.push(buildList(buffer));
    buffer = [];
    afterBlank = false;
  };

  // Ítem al que pertenece una continuación sangrada `indent` espacios: el
  // último cuyo marcador está menos sangrado que ella (`  b` tras `- a` y su
  // sublista `  - sub` pertenece a `a`, no a `sub`).
  const ownerOf = (indent: number): ListItem => {
    for (let k = buffer.length - 1; k >= 0; k--) {
      if (buffer[k].indent < indent) return buffer[k];
    }
    return buffer[buffer.length - 1];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const taskMatch = /^([ \t]*)[-*+] \[([ xX])\](?: (.*))?$/.exec(line);
    const bulletMatch = /^([ \t]*)[-*+](?: (.*))?$/.exec(line);
    const orderedMatch = /^([ \t]*)(\d+)[.)](?: (.*))?$/.exec(line);

    if (taskMatch) {
      const checked = taskMatch[2].toLowerCase() === 'x';
      buffer.push({
        kind: 'task',
        indent: indentOf(taskMatch[1]),
        li: `<li data-type="taskItem" data-checked="${checked}"><p>${taskMatch[3] ?? ''}</p>`,
        after: '',
      });
      afterBlank = false;
    } else if (bulletMatch) {
      buffer.push({
        kind: 'ul',
        indent: indentOf(bulletMatch[1]),
        li: `<li>${bulletMatch[2] ?? ''}`,
        after: '',
      });
      afterBlank = false;
    } else if (orderedMatch) {
      buffer.push({
        kind: 'ol',
        indent: indentOf(orderedMatch[1]),
        start: Number(orderedMatch[2]),
        li: `<li>${orderedMatch[3] ?? ''}`,
        after: '',
      });
      afterBlank = false;
    } else if (buffer.length > 0 && /^[ \t]+\S/.test(line)) {
      const text = line.trim();
      const indent = indentOf(/^[ \t]*/.exec(line)![0]);
      const last = buffer[buffer.length - 1];
      if (CODEBLOCK_PLACEHOLDER.test(text)) {
        // Bloque de código del ítem: va tal cual (STEP 8 lo restaura).
        const owner = ownerOf(indent);
        if (owner === last) last.li += text;
        else owner.after += text;
      } else if (afterBlank) {
        // Párrafo adicional del ítem (línea en blanco + texto sangrado).
        const owner = ownerOf(indent);
        if (owner === last) last.li += `<p>${text}</p>`;
        else owner.after += `<p>${text}</p>`;
      } else {
        // Línea de continuación indentada de un ítem multilínea: se une al
        // ítem anterior (soft wrap). Sin esto, la línea rompía la lista en
        // varios <ol> de un ítem y la numeración se reiniciaba (1, 1, 1…).
        last.li = last.li.endsWith('</p>')
          ? `${last.li.slice(0, -4)} ${text}</p>`
          : `${last.li} ${text}`;
      }
      afterBlank = false;
    } else if (
      buffer.length > 0 &&
      !line.trim() &&
      (isListLine(lines[i + 1] ?? '') || /^(?: {2,}|\t)\S/.test(lines[i + 1] ?? ''))
    ) {
      // Línea en blanco entre ítems (lista «loose») o antes de un párrafo
      // sangrado del ítem: no rompe la lista.
      afterBlank = true;
    } else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join('\n');
};

// ---------- Párrafos ----------
// Envuelve las líneas de texto suelto en <p>. Las líneas vacías o que ya son
// un bloque HTML se dejan tal cual. Las líneas CONTIGUAS se fusionan en un
// único párrafo con <br> (salto duro): así un salto simple del archivo sigue
// siendo un salto simple al guardar (la regla softLineBreak de Turndown lo
// emite como `\n`), en vez de explotar en párrafos sueltos que se serializan
// con línea en blanco de por medio — el origen de los "retornos de más" al
// pegar texto de una terminal.
const blockElementStart = /^<(?:h[1-6]|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|blockquote|pre|hr|p|div|figure)\b/i;
const blockElementEnd = /<\/(?:h[1-6]|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|blockquote|pre|p|div|figure)>$/i;
const ATOM_ONLY_LINE = /^(?:<!--IUR-ATOM-\d+-->\s*)+$/;

const wrapParagraphs = (html: string, isBlockAtom: (idx: number) => boolean): string => {
  const outLines: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      outLines.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    }
  };
  for (const line of html.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      outLines.push('');
      continue;
    }
    if (blockElementStart.test(trimmed) || blockElementEnd.test(trimmed) || trimmed === '<hr>') {
      flushPara();
      outLines.push(line);
      continue;
    }
    if (trimmed.startsWith('<!--IUR-CODEBLOCK-')) {
      // Leave the placeholder bare on its own line — STEP 8 swaps it for
      // the actual block. Wrapping it in <p> would produce invalid HTML.
      flushPara();
      outLines.push(trimmed);
      continue;
    }
    if (ATOM_ONLY_LINE.test(trimmed)) {
      // Línea que sólo contiene imágenes: la imagen es un nodo de bloque en
      // el editor, y envuelta en <p> el parser dejaba un párrafo VACÍO
      // delante de cada imagen (una línea en blanco fantasma al abrir).
      const idxs = Array.from(trimmed.matchAll(/<!--IUR-ATOM-(\d+)-->/g), m => Number(m[1]));
      if (idxs.every(isBlockAtom)) {
        flushPara();
        outLines.push(trimmed);
        continue;
      }
    }
    para.push(trimmed);
  }
  flushPara();
  return outLines.join('\n');
};

// Helper to convert markdown to HTML for initial load.
export const markdownToHtml = (markdown: string): string => {
  // TipTap parses HTML, not markdown. We need to do a faithful conversion of
  // the structural markdown features (code blocks, headings, lists, tables,
  // blockquotes) into HTML so the editor renders them as real nodes instead
  // of plain text paragraphs. Anything we miss here will round-trip badly.

  // STEP 1 — Extract fenced code blocks FIRST and replace with placeholders.
  // We do this before any other transformation so backticks, hash signs,
  // pipes, etc. inside the code body are preserved verbatim.
  const codeBlocks: string[] = [];
  // Use an HTML comment as placeholder: it is inert to all markdown regexes
  // (bold/italic/heading/list) and to TipTap's HTML parser.
  const codeBlockPlaceholder = (i: number) => `<!--IUR-CODEBLOCK-${i}-->`;
  const withoutCodeBlocks = markdown.replace(
    /^([ \t]*)(```+|~~~+)([^\n`~]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm,
    (_match, indent: string, _fence, langRaw, rawBody: string) => {
      const lang = (langRaw || '').trim().split(/\s+/)[0] || '';
      const idx = codeBlocks.length;
      // Fence sangrado (bloque de código dentro de un ítem de lista): la
      // sangría es del ítem, no del código. Se quita de cada línea y el
      // placeholder conserva la sangría para que STEP 5 lo adjunte al ítem.
      const body = indent
        ? rawBody
            .split('\n')
            .map(l => l.replace(new RegExp(`^[ \\t]{0,${indent.length}}`), ''))
            .join('\n')
        : rawBody;
      if (lang === 'mermaid') {
        // Nodo atómico para la extensión Mermaid (render en vivo). El código
        // va también como texto interno: Turndown descarta divs vacíos
        // (isBlank) antes de aplicar reglas, y así el nodo nunca queda vacío.
        codeBlocks.push(
          `<div data-type="mermaid" data-code="${escapeHtmlAttr(body)}">${escapeHtmlForCode(body)}</div>`
        );
      } else {
        const classAttr = lang ? ` class="language-${lang}"` : '';
        codeBlocks.push(`<pre><code${classAttr}>${escapeHtmlForCode(body)}</code></pre>`);
      }
      return `${indent}${codeBlockPlaceholder(idx)}`;
    }
  );

  let html = withoutCodeBlocks;

  // STEP 1a-bis — Math en bloque ($$…$$). Reutiliza el mecanismo de
  // placeholders de codeBlocks (comentario HTML inerte + restauración final).
  // Multilínea primero; luego la forma de una sola línea.
  const pushMathBlock = (latex: string): string => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<div data-math-block="true" data-latex="${escapeHtmlAttr(latex)}">${escapeHtmlForCode(latex)}</div>`
    );
    return codeBlockPlaceholder(idx);
  };
  html = html.replace(
    /^[ \t]*\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*$/gm,
    (_m, latex) => pushMathBlock(latex)
  );
  html = html.replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_m, latex) =>
    pushMathBlock(latex.trim())
  );

  // STEP 1b — Extract inline code spans BEFORE any inline formatting.
  // Without this, `mcgenera_posicion_k` first became
  // `mcgenera<em>posicion</em>k` (italic regex) and the <em> quedaba como
  // texto literal escapado dentro del <code>.
  const inlineCodes: string[] = [];
  const inlineCodePlaceholder = (i: number) => `<!--IUR-INLINECODE-${i}-->`;
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtmlForCode(c)}</code>`);
    return inlineCodePlaceholder(idx);
  });

  // STEP 1b-bis — Footnote DEFINITIONS (línea completa `[^x]: texto`) antes
  // que las referencias, para que el regex de refs no se coma la etiqueta.
  // El texto interno queda expuesto al formato inline posterior.
  html = html.replace(
    /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm,
    (_m, label, text) => `<div data-fn-def="${escapeHtmlAttr(label)}">${text}</div>`
  );

  // STEP 1c — Extract images and link TARGETS before inline formatting.
  // Un nombre de archivo como `logo_con_guiones.png` dentro de
  // ![alt](assets/logo_con_guiones.png) era destrozado por el regex de
  // cursivas (`_..._` → <em>) y la ruta guardada dejaba de existir.
  const inlineAtoms: string[] = [];
  const atomPlaceholder = (i: number) => `<!--IUR-ATOM-${i}-->`;
  // Math inline `$…$`. Heurísticas anti-falso-positivo (importes en pesos):
  // sin espacio tras el $ de apertura ni antes del de cierre, el cierre no va
  // seguido de dígito, y un `\$` escapado no abre fórmula.
  html = html.replace(
    /\$(?!\s)((?:\\.|[^$\n\\])+?)\$(?!\d)/g,
    (m, latex: string, offset: number, s: string) => {
      if (/\s$/.test(latex)) return m;
      if (offset > 0 && s[offset - 1] === '\\') return m;
      const idx = inlineAtoms.length;
      inlineAtoms.push(
        `<span data-math-inline="true" data-latex="${escapeHtmlAttr(latex)}">${escapeHtmlForCode(latex)}</span>`
      );
      return atomPlaceholder(idx);
    }
  );
  // Referencias de nota al pie `[^x]` (sin dos puntos: las definiciones ya
  // fueron consumidas arriba).
  html = html.replace(/\[\^([^\]\s]+)\]/g, (_m, label) => {
    const idx = inlineAtoms.length;
    inlineAtoms.push(
      `<sup data-fn-ref="${escapeHtmlAttr(label)}">${escapeHtmlForCode(label)}</sup>`
    );
    return atomPlaceholder(idx);
  });
  // Imágenes completas (el alt es atributo: sin formato markdown dentro)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt, url, title) => {
      const idx = inlineAtoms.length;
      inlineAtoms.push(
        `<img src="${url}" alt="${escapeHtmlAttr(alt || '')}"${title ? ` title="${escapeHtmlAttr(title)}"` : ''} />`
      );
      return atomPlaceholder(idx);
    }
  );
  // Enlaces: se protege sólo la etiqueta de apertura (con la URL); el texto
  // del enlace queda fuera para que negritas/cursivas sigan aplicando.
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, text, url, title) => {
      const idx = inlineAtoms.length;
      inlineAtoms.push(`<a href="${url}"${title ? ` title="${escapeHtmlAttr(title)}"` : ''}>`);
      return `${atomPlaceholder(idx)}${text}</a>`;
    }
  );

  // STEP 2 — Headers (atx style). Must come before inline replacements so
  // the `#` characters at line start are consumed.
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // STEP 3 — Inline formatting. Order matters: bold+italic, bold, italic.
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  // Guiones bajos: según CommonMark el énfasis con _ NO aplica dentro de
  // palabra (snake_case, nombres_de_archivo quedan literales).
  html = html.replace(/(^|[^\w])__([^_\n](?:.*?[^_\n])?)__(?!\w)/g, '$1<strong>$2</strong>');
  html = html.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');

  // Horizontal rules
  html = html.replace(/^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/gm, '<hr>');

  // STEP 4 — Tables. A consecutive block of lines starting with `|`.
  {
    const lines = html.split('\n');
    const out: string[] = [];
    let tableBuffer: string[] = [];

    const flushTable = () => {
      if (tableBuffer.length >= 2) {
        out.push(markdownTableToHtml(tableBuffer, idx => inlineAtoms[idx]?.startsWith('<img') ?? false));
      } else {
        for (const tl of tableBuffer) out.push(tl);
      }
      tableBuffer = [];
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
        tableBuffer.push(trimmed);
      } else {
        if (tableBuffer.length > 0) flushTable();
        out.push(line);
      }
    }
    if (tableBuffer.length > 0) flushTable();
    html = out.join('\n');
  }

  // STEP 5 — Lists (ver convertLists).
  html = convertLists(html);

  // STEP 6 — Blockquotes. Group consecutive `>` lines into a single
  // <blockquote> with line breaks preserved.
  {
    const lines = html.split('\n');
    const out: string[] = [];
    let quoteBuffer: string[] = [];

    // Callout / admonición: primera línea `[!TIPO]` (GitHub/Obsidian).
    const CALLOUT_TYPES = new Set(['note', 'tip', 'important', 'warning', 'caution']);
    // Cuerpo de la cita: si trae listas, se convierten en nodos reales (y el
    // resto en párrafos); si no, un único párrafo con saltos duros. Todo en
    // una sola línea para que el envoltorio quede entero ante STEP 7.
    const quoteBody = (lines: string[]): string => {
      if (lines.some(isListLine)) {
        return wrapParagraphs(convertLists(lines.join('\n')), () => false)
          .split('\n')
          .filter(Boolean)
          .join('');
      }
      return `<p>${lines.join('<br>')}</p>`;
    };
    const flushQuote = () => {
      if (quoteBuffer.length === 0) return;
      const marker = /^\[!(\w+)\]\s*(.*)$/.exec(quoteBuffer[0]);
      const type = marker?.[1].toLowerCase();
      if (type && CALLOUT_TYPES.has(type)) {
        const body: string[] = [];
        if (marker?.[2]) body.push(marker[2]);
        for (let i = 1; i < quoteBuffer.length; i++) body.push(quoteBuffer[i]);
        out.push(`<div data-callout="${type}">${quoteBody(body)}</div>`);
      } else {
        out.push(`<blockquote>${quoteBody(quoteBuffer)}</blockquote>`);
      }
      quoteBuffer = [];
    };

    for (const line of lines) {
      const m = /^>\s?(.*)$/.exec(line);
      if (m) {
        quoteBuffer.push(m[1]);
      } else {
        if (quoteBuffer.length > 0) flushQuote();
        out.push(line);
      }
    }
    if (quoteBuffer.length > 0) flushQuote();
    html = out.join('\n');
  }

  // STEP 7 — Wrap remaining plain-text lines into <p> tags (ver
  // wrapParagraphs). Las imágenes son los únicos átomos de bloque.
  html = wrapParagraphs(html, idx => inlineAtoms[idx]?.startsWith('<img') ?? false);

  // STEP 8 — Restore placeholders (átomos e inline code, luego bloques).
  html = html.replace(/<!--IUR-ATOM-(\d+)-->/g, (_m, i) => inlineAtoms[Number(i)] || '');
  html = html.replace(/<!--IUR-INLINECODE-(\d+)-->/g, (_m, i) => inlineCodes[Number(i)] || '');
  html = html.replace(/<!--IUR-CODEBLOCK-(\d+)-->/g, (_m, i) => codeBlocks[Number(i)] || '');

  return html;
};

// Build the HTML→Markdown converter with all the round-trip fixes (identity
// escape, task lists, tables, fenced code with language, mermaid nodes).
// Marcador de un <li>: `- ` o `N. ` (respetando `start` del <ol>).
const listItemPrefix = (li: HTMLElement): string => {
  const parent = li.parentNode as HTMLElement | null;
  if (parent && parent.nodeName === 'OL') {
    const start = Number(parent.getAttribute('start') || 1);
    const index = Array.prototype.indexOf.call(parent.children, li);
    return `${start + index}. `;
  }
  if (li.getAttribute('data-type') === 'taskItem') {
    return `- [${li.getAttribute('data-checked') === 'true' ? 'x' : ' '}] `;
  }
  return '- ';
};

export const buildTurndownService = (): TurndownService => {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    // Un <li> vacío (ítem recién creado sin texto) es «blank» para Turndown
    // y desaparecía — y con él el salto, partiendo la lista en dos. Se
    // conserva como ítem vacío.
    blankReplacement: (_content, node) => {
      if (node.nodeName === 'LI') {
        return listItemPrefix(node as HTMLElement).trimEnd() + (node.nextSibling ? '\n' : '');
      }
      return (node as HTMLElement & { isBlock?: boolean }).isBlock ? '\n\n' : '';
    },
  });

  // Disable Turndown's aggressive markdown escaping. Default behaviour
  // backslash-escapes `#`, `-`, `*`, `>`, `|`, etc. inside paragraph text.
  // TipTap already represents structural elements as dedicated DOM nodes —
  // a literal `#` inside a <p> is text and won't be re-interpreted as a
  // heading. With escaping on, every save/edit round-trip adds another
  // backslash: "# foo" → "\# foo" → "\\# foo" …
  (service as unknown as { escape: (s: string) => string }).escape = (s: string) => s;

  // Salto duro (<br>) → salto de línea simple. El default de Turndown emite
  // "  \n" (dos espacios), que nuestro parser no reconoce; con `\n` el par
  // markdownToHtml/turndown es identidad para líneas contiguas de un párrafo.
  service.addRule('softLineBreak', {
    filter: 'br',
    replacement: () => '\n',
  });

  // Callout → blockquote con marcador `> [!TIPO]`
  service.addRule('callout', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.getAttribute('data-callout') !== null,
    replacement: (content, node) => {
      const type = (node as HTMLElement).getAttribute('data-callout') || 'note';
      const inner = content.trim();
      const body = inner
        ? inner
            .split('\n')
            .map((l) => (l.trim() ? `> ${l}` : '>'))
            .join('\n')
        : '';
      return `\n\n> [!${type.toUpperCase()}]${body ? `\n${body}` : ''}\n\n`;
    },
  });

  // Nodo mermaid → fence verbatim
  service.addRule('mermaidNode', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.getAttribute('data-type') === 'mermaid',
    replacement: (_content, node) => {
      const code = (node as HTMLElement).getAttribute('data-code') || '';
      return `\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\n`;
    },
  });

  // Imágenes locales: el DOM lleva src resuelto (asset protocol de Tauri)
  // pero la ruta original relativa viaja en data-orig-src — es la que debe
  // quedar en el markdown para que el archivo sea portable.
  service.addRule('localImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src = el.getAttribute('data-orig-src') || el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      const title = el.getAttribute('title');
      // Una URL `blob:` sólo vive mientras la ventana está abierta: guardarla
      // deja un `![](blob:…)` que nunca vuelve a mostrarse. Mejor nada.
      if (/^blob:/i.test(src)) return '';
      return src ? `![${alt}](${src}${title ? ` "${title}"` : ''})` : '';
    },
  });

  // Fórmulas KaTeX → sintaxis $ / $$
  service.addRule('mathInline', {
    filter: (node) =>
      node.nodeName === 'SPAN' && node.getAttribute('data-math-inline') !== null,
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const latex = el.getAttribute('data-latex') || el.textContent || '';
      return latex ? `$${latex}$` : '';
    },
  });

  service.addRule('mathBlock', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.getAttribute('data-math-block') !== null,
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const latex = el.getAttribute('data-latex') || el.textContent || '';
      return latex ? `\n\n$$\n${latex}\n$$\n\n` : '';
    },
  });

  // Notas al pie: referencia inline y definición de bloque → sintaxis [^x]
  service.addRule('footnoteRef', {
    filter: (node) =>
      node.nodeName === 'SUP' && node.getAttribute('data-fn-ref') !== null,
    replacement: (_content, node) =>
      `[^${(node as HTMLElement).getAttribute('data-fn-ref')}]`,
  });

  service.addRule('footnoteDef', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.getAttribute('data-fn-def') !== null,
    replacement: (content, node) => {
      const label = (node as HTMLElement).getAttribute('data-fn-def') || '';
      return `\n\n[^${label}]: ${content.trim()}\n\n`;
    },
  });

  // ---- Listas ----
  // Turndown emite `-   texto` (tres espacios) y, con ítems de un párrafo,
  // una línea de SOLO espacios entre ítem e ítem; el resultado era un
  // markdown feo y una lista «loose». Aquí: `- texto`, sublistas pegadas al
  // ítem, párrafos adicionales y bloques de código sangrados al ancho del
  // marcador, sin líneas de espacios.
  const indentListContent = (content: string, prefixLen: number): string => {
    const indent = ' '.repeat(prefixLen);
    return content
      .replace(/^\n+/, '')
      .replace(/\s+$/, '')
      // Línea en blanco entre el texto del ítem y su sublista: la lista
      // queda «tight» (el parser también lo acepta, pero así el markdown
      // es el que escribiría una persona).
      .replace(/\n{2,}(?=[ \t]*(?:[-*+]|\d+[.)]) )/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((l, i) => (i === 0 ? l : l.trim() ? indent + l : ''))
      .join('\n');
  };

  service.addRule('listItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') !== 'taskItem',
    replacement: (content, node) => {
      const prefix = listItemPrefix(node as HTMLElement);
      return prefix + indentListContent(content, prefix.length) + (node.nextSibling ? '\n' : '');
    },
  });

  // Tareas: `- [x] texto`; las subtareas y párrafos del ítem se sangran
  // como en cualquier lista (antes `content.trim()` aplanaba el anidamiento).
  service.addRule('taskListItem', {
    filter: (node) => {
      return node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem';
    },
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const checked = element.getAttribute('data-checked') === 'true';
      const prefix = `- [${checked ? 'x' : ' '}] `;
      return prefix + indentListContent(content, 2) + (node.nextSibling ? '\n' : '');
    },
  });

  // ---- Tablas ----
  // Una celda markdown sólo admite contenido inline. Para no perder lo que
  // el editor permite dentro de una celda:
  //  - varios párrafos y saltos duros → `<br>` (GFM lo renderiza como salto);
  //  - listas (también de tareas) → `<ul>/<ol>` HTML embebido, que TipTap
  //    vuelve a parsear como lista al abrir y GitHub muestra como lista.
  // Antes todo se aplanaba a una sola línea con espacios: una lista de
  // viñetas en una celda volvía como «- uno - dos».
  const inlineOf = (html: string): string =>
    service.turndown(html).replace(/\n+/g, '<br>').trim();

  const listToHtml = (list: HTMLElement): string => {
    const tag = list.nodeName.toLowerCase();
    const isTask = list.getAttribute('data-type') === 'taskList';
    const start = list.getAttribute('start');
    const attrs = isTask
      ? ' data-type="taskList"'
      : tag === 'ol' && start && start !== '1'
        ? ` start="${start}"`
        : '';
    const items = Array.from(list.children)
      .filter((li) => li.nodeName === 'LI')
      .map((li) => {
        const liAttrs = isTask
          ? ` data-type="taskItem" data-checked="${li.getAttribute('data-checked') === 'true'}"`
          : '';
        // El contenido de un taskItem renderizado vive en un <div> tras el
        // <label> del checkbox.
        const container =
          isTask ? (Array.from(li.children).find((c) => c.nodeName === 'DIV') ?? li) : li;
        return `<li${liAttrs}>${cellToMarkdown(container as HTMLElement)}</li>`;
      });
    return `<${tag}${attrs}>${items.join('')}</${tag}>`;
  };

  const cellToMarkdown = (cell: HTMLElement): string => {
    const parts: { block: boolean; text: string }[] = [];
    for (const child of Array.from(cell.childNodes)) {
      if (child.nodeType === 3) {
        const text = (child.textContent || '').trim();
        if (text) parts.push({ block: false, text: inlineOf(escapeHtmlForCode(child.textContent || '')) });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as HTMLElement;
      const name = el.nodeName;
      if (name === 'LABEL') continue; // checkbox de un taskItem
      if (name === 'UL' || name === 'OL') {
        parts.push({ block: true, text: listToHtml(el) });
      } else if (name === 'PRE') {
        const code = (el.textContent || '').trim().replace(/\n+/g, ' ');
        if (code) parts.push({ block: false, text: `\`${code}\`` });
      } else if (/^H[1-6]$/.test(name)) {
        const inner = inlineOf(el.innerHTML);
        if (inner) parts.push({ block: false, text: `**${inner}**` });
      } else {
        const inner = inlineOf(el.outerHTML);
        if (inner) parts.push({ block: false, text: inner });
      }
    }
    let out = '';
    parts.forEach((part, i) => {
      // Entre dos fragmentos inline (párrafos) va un salto; junto a una lista
      // no hace falta (y un <br> extra crecería en cada guardado).
      if (i > 0 && !part.block && !parts[i - 1].block && !/<br>$/.test(out)) out += '<br>';
      out += part.text;
    });
    return out.replace(/\|/g, '\\|');
  };

  // Alineación de una columna (`:---:`): la del párrafo de la celda de
  // encabezado o, si no tiene, la primera celda alineada de la columna.
  const cellAlign = (cell: HTMLElement | undefined): string | null => {
    if (!cell) return null;
    const styled = cell.querySelector<HTMLElement>('[style*="text-align"]');
    const align = (styled ?? cell).style?.textAlign || '';
    return align === 'center' || align === 'right' || align === 'left' ? align : null;
  };
  const separatorCell = (align: string | null): string =>
    align === 'center' ? ':---:' : align === 'right' ? '---:' : '---';

  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const element = node as HTMLTableElement;
      const rows = Array.from(element.querySelectorAll('tr'));
      if (!rows.length) return '';

      // Celdas por fila, expandiendo colspan en celdas vacías: markdown no
      // tiene combinación de celdas, pero así ninguna columna se desplaza.
      const grid: string[][] = [];
      const cellsByRow: HTMLElement[][] = [];
      for (const row of rows) {
        const cells = Array.from(row.children).filter(
          (c) => c.nodeName === 'TD' || c.nodeName === 'TH'
        ) as HTMLElement[];
        const line: string[] = [];
        const expanded: HTMLElement[] = [];
        for (const cell of cells) {
          line.push(cellToMarkdown(cell));
          expanded.push(cell);
          const span = Number(cell.getAttribute('colspan') || 1);
          for (let k = 1; k < span; k++) {
            line.push('');
            expanded.push(cell);
          }
        }
        grid.push(line);
        cellsByRow.push(expanded);
      }
      const cols = Math.max(...grid.map((r) => r.length));
      const pad = (r: string[]) => (r.length < cols ? [...r, ...Array(cols - r.length).fill('')] : r);

      const aligns: (string | null)[] = [];
      for (let c = 0; c < cols; c++) {
        let align = cellAlign(cellsByRow[0]?.[c]);
        for (let r = 1; r < cellsByRow.length && !align; r++) align = cellAlign(cellsByRow[r]?.[c]);
        aligns.push(align);
      }

      let markdown = '\n\n';
      grid.forEach((row, rowIndex) => {
        markdown += '| ' + pad(row).join(' | ') + ' |\n';
        // Add separator after header row
        if (rowIndex === 0) {
          markdown += '| ' + aligns.map(separatorCell).join(' | ') + ' |\n';
        }
      });

      return markdown + '\n';
    },
  });

  // Prevent TurndownService from processing table sub-elements individually
  service.addRule('tableCell', {
    filter: ['td', 'th', 'tr', 'thead', 'tbody', 'tfoot'],
    replacement: () => '',
  });

  // Fenced code blocks with language hint. TipTap renders
  // `<pre><code class="language-x">...</code></pre>`.
  service.addRule('fencedCodeBlock', {
    filter: (node) => {
      if (node.nodeName !== 'PRE') return false;
      const code = (node as HTMLElement).querySelector('code');
      // Ensure <code> is a direct child of <pre>, not nested deeper.
      return !!code && code.parentNode === node;
    },
    replacement: (_content, node) => {
      const code = (node as HTMLElement).querySelector('code') as HTMLElement;
      const className = code.getAttribute('class') || '';
      const langMatch = /language-(\S+)/.exec(className);
      const language = langMatch ? langMatch[1] : '';
      // Use textContent so we get the raw code without HTML entities.
      // textContent also flattens any syntax-highlight <span> tokens that
      // lowlight may have injected into the rendered DOM.
      const raw = code.textContent || '';
      // Strip a single trailing newline if present (highlight adds one).
      const body = raw.replace(/\n$/, '');
      return `\n\n\`\`\`${language}\n${body}\n\`\`\`\n\n`;
    },
  });

  return service;
};

// Heal previously-corrupted files: versions that used Turndown's default
// escape accumulated backslash layers (`\#` → `\\#` → `\\\#`). Collapse 2+
// backslashes followed by a markdown metacharacter at line start down to the
// bare character. Single `\#` is left alone (could be an intentional literal).
export const healEscapedMarkdown = (markdown: string): string =>
  markdown.replace(/^(\\){2,}([#\-*+>|])/gm, '$2');

// ---------- Front matter YAML ----------
// Un documento puede empezar con un bloque de metadatos YAML delimitado por
// `---` (convención de Jekyll/Obsidian/pandoc). No se renderiza en el editor:
// se separa al cargar y se antepone verbatim al guardar.

export interface FrontMatterSplit {
  /** Bloque completo con sus delimitadores, sin salto final. '' si no hay. */
  frontMatter: string;
  /** El resto del documento. */
  body: string;
}

export const splitFrontMatter = (raw: string): FrontMatterSplit => {
  // Debe empezar en el byte 0 (BOM aparte); el cierre puede ser `---` o `...`.
  const m = /^﻿?---[ \t]*\n([\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(raw);
  if (!m) return { frontMatter: '', body: raw };
  // Anti-falso-positivo: un doc que empieza con `---` como regla horizontal.
  // El bloque debe parecer YAML: al menos una línea `clave:` (o estar vacío).
  const inner = m[1] ?? '';
  if (inner.trim() && !/^[ \t]*[\w.-]+[ \t]*:/m.test(inner)) {
    return { frontMatter: '', body: raw };
  }
  return {
    frontMatter: m[0].replace(/\n+$/, ''),
    body: raw.slice(m[0].length).replace(/^\n+/, ''),
  };
};

export const joinFrontMatter = (frontMatter: string, body: string): string =>
  frontMatter ? `${frontMatter}\n\n${body}` : body;

/** Campos simples `clave: valor` del front matter (claves en minúsculas,
 *  sin comillas). Suficiente para prellenar encabezados de impresión;
 *  no es un parser YAML completo. */
export const parseFrontMatterFields = (frontMatter: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const line of frontMatter.split('\n')) {
    if (/^(?:---|\.\.\.)\s*$/.test(line)) continue;
    const m = /^([\w.-]+)\s*:\s*(.+)$/.exec(line);
    if (m) fields[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
};

// Prepara el contenido de un archivo para cargarlo en el editor.
export const prepareContent = (raw: string): string => {
  if (!raw) return '';
  const cleaned = healEscapedMarkdown(raw);
  if (isHtmlContent(cleaned)) return cleaned;
  return markdownToHtml(cleaned);
};
