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

// Convert a markdown table block (array of lines) into an HTML <table>
const markdownTableToHtml = (tableLines: string[]): string => {
  if (tableLines.length < 2) return tableLines.map(l => `<p>${l}</p>`).join('\n');

  const parseRow = (line: string): string[] => {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length > 0 && cells[0] === '') cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  };

  const isSeparator = (line: string) => /^\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(line);

  const headerCells = parseRow(tableLines[0]);
  const hasSeparator = isSeparator(tableLines[1]);
  const dataStartIndex = hasSeparator ? 2 : 1;

  let html = '<table><tbody>';

  html += '<tr>';
  for (const cell of headerCells) {
    html += `<th>${cell}</th>`;
  }
  html += '</tr>';

  for (let i = dataStartIndex; i < tableLines.length; i++) {
    const cells = parseRow(tableLines[i]);
    html += '<tr>';
    for (const cell of cells) {
      html += `<td>${cell}</td>`;
    }
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
    (_match, _indent, _fence, langRaw, body) => {
      const lang = (langRaw || '').trim().split(/\s+/)[0] || '';
      const idx = codeBlocks.length;
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
      return codeBlockPlaceholder(idx);
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
        out.push(markdownTableToHtml(tableBuffer));
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

  // STEP 5 — Lists. Group consecutive bullet/ordered/task lines and build
  // nested <ul>/<ol> according to indentation (2+ espacios o tab = un nivel
  // más profundo; Turndown emite 4 espacios al guardar).
  {
    type ListKind = 'ul' | 'ol' | 'task';
    interface ListItem {
      kind: ListKind;
      indent: number;
      li: string; // <li> SIN cerrar — las sublistas van dentro
    }

    const openTag = (kind: ListKind) =>
      kind === 'task' ? '<ul data-type="taskList">' : kind === 'ol' ? '<ol>' : '<ul>';
    const closeTag = (kind: ListKind) => (kind === 'ol' ? '</ol>' : '</ul>');

    const buildList = (items: ListItem[]): string => {
      const out: string[] = [];
      const stack: { kind: ListKind; indent: number }[] = [];
      for (const item of items) {
        if (stack.length === 0) {
          out.push(openTag(item.kind));
          stack.push({ kind: item.kind, indent: item.indent });
        } else if (item.indent > stack[stack.length - 1].indent) {
          // Sublista: se abre dentro del <li> aún sin cerrar.
          out.push(openTag(item.kind));
          stack.push({ kind: item.kind, indent: item.indent });
        } else {
          out.push('</li>');
          while (stack.length > 1 && item.indent < stack[stack.length - 1].indent) {
            out.push(closeTag(stack.pop()!.kind), '</li>');
          }
          if (item.kind !== stack[stack.length - 1].kind) {
            out.push(closeTag(stack.pop()!.kind));
            out.push(openTag(item.kind));
            stack.push({ kind: item.kind, indent: item.indent });
          }
        }
        out.push(item.li);
      }
      out.push('</li>');
      while (stack.length) {
        out.push(closeTag(stack.pop()!.kind));
        if (stack.length) out.push('</li>');
      }
      return out.join('');
    };

    const indentOf = (ws: string): number =>
      ws.replace(/\t/g, '    ').length;

    const lines = html.split('\n');
    const out: string[] = [];
    let buffer: ListItem[] = [];

    const flush = () => {
      if (buffer.length) out.push(buildList(buffer));
      buffer = [];
    };

    for (const line of lines) {
      const taskMatch = /^([ \t]*)[-*+] \[([ xX])\] (.*)$/.exec(line);
      const bulletMatch = /^([ \t]*)[-*+] (.*)$/.exec(line);
      const orderedMatch = /^([ \t]*)(\d+)[.)] (.*)$/.exec(line);

      if (taskMatch) {
        const checked = taskMatch[2].toLowerCase() === 'x';
        buffer.push({
          kind: 'task',
          indent: indentOf(taskMatch[1]),
          li: `<li data-type="taskItem" data-checked="${checked}"><p>${taskMatch[3]}</p>`,
        });
      } else if (bulletMatch) {
        buffer.push({
          kind: 'ul',
          indent: indentOf(bulletMatch[1]),
          li: `<li>${bulletMatch[2]}`,
        });
      } else if (orderedMatch) {
        buffer.push({
          kind: 'ol',
          indent: indentOf(orderedMatch[1]),
          li: `<li>${orderedMatch[3]}`,
        });
      } else {
        flush();
        out.push(line);
      }
    }
    flush();
    html = out.join('\n');
  }

  // STEP 6 — Blockquotes. Group consecutive `>` lines into a single
  // <blockquote> with line breaks preserved.
  {
    const lines = html.split('\n');
    const out: string[] = [];
    let quoteBuffer: string[] = [];

    const flushQuote = () => {
      if (quoteBuffer.length === 0) return;
      out.push(`<blockquote><p>${quoteBuffer.join('<br>')}</p></blockquote>`);
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

  // STEP 7 — Wrap remaining plain-text lines into <p> tags. Lines that
  // are empty or already an HTML block element are left alone.
  const blockElementStart = /^<(?:h[1-6]|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|blockquote|pre|hr|p|div|figure)\b/i;
  const blockElementEnd = /<\/(?:h[1-6]|ul|ol|li|table|tr|td|th|thead|tbody|tfoot|blockquote|pre|p|div|figure)>$/i;
  html = html.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (blockElementStart.test(trimmed) || blockElementEnd.test(trimmed) || trimmed === '<hr>') {
      return line;
    }
    if (trimmed.startsWith('<!--IUR-CODEBLOCK-')) {
      // Leave the placeholder bare on its own line — STEP 8 swaps it for
      // the actual block. Wrapping it in <p> would produce invalid HTML.
      return trimmed;
    }
    return `<p>${trimmed}</p>`;
  }).join('\n');

  // STEP 8 — Restore placeholders (átomos e inline code, luego bloques).
  html = html.replace(/<!--IUR-ATOM-(\d+)-->/g, (_m, i) => inlineAtoms[Number(i)] || '');
  html = html.replace(/<!--IUR-INLINECODE-(\d+)-->/g, (_m, i) => inlineCodes[Number(i)] || '');
  html = html.replace(/<!--IUR-CODEBLOCK-(\d+)-->/g, (_m, i) => codeBlocks[Number(i)] || '');

  return html;
};

// Build the HTML→Markdown converter with all the round-trip fixes (identity
// escape, task lists, tables, fenced code with language, mermaid nodes).
export const buildTurndownService = (): TurndownService => {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // Disable Turndown's aggressive markdown escaping. Default behaviour
  // backslash-escapes `#`, `-`, `*`, `>`, `|`, etc. inside paragraph text.
  // TipTap already represents structural elements as dedicated DOM nodes —
  // a literal `#` inside a <p> is text and won't be re-interpreted as a
  // heading. With escaping on, every save/edit round-trip adds another
  // backslash: "# foo" → "\# foo" → "\\# foo" …
  (service as unknown as { escape: (s: string) => string }).escape = (s: string) => s;

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

  // Add custom rules for task lists
  service.addRule('taskListItem', {
    filter: (node) => {
      return node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem';
    },
    replacement: (content, node) => {
      const element = node as HTMLElement;
      const checked = element.getAttribute('data-checked') === 'true';
      return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
    },
  });

  // Handle tables — convert each cell recursively so bold/links survive
  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const element = node as HTMLTableElement;
      const rows = element.querySelectorAll('tr');
      let markdown = '\n';

      rows.forEach((row, rowIndex) => {
        const cells = row.querySelectorAll('th, td');
        const cellContents: string[] = [];

        cells.forEach((cell) => {
          // Use turndown on inner HTML to preserve bold, links, etc.
          const inner = service.turndown((cell as HTMLElement).innerHTML)
            .replace(/\n/g, ' ')  // collapse newlines within cells
            .replace(/\|/g, '\\|')  // escape pipes in content
            .trim();
          cellContents.push(inner || '');
        });

        markdown += '| ' + cellContents.join(' | ') + ' |\n';

        // Add separator after header row
        if (rowIndex === 0) {
          markdown += '| ' + cellContents.map(() => '---').join(' | ') + ' |\n';
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
