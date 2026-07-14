import TurndownService from 'turndown';

// Round-trip markdown ↔ HTML para TipTap, portado de Colaborador especialista
// (TipTapEditor.tsx). Cambio principal para iureditor: los bloques ```mermaid
// se convierten en <div data-type="mermaid" data-code="..."> para que la
// extensión Mermaid de TipTap los renderice como diagrama en vivo, y la regla
// inversa de Turndown los devuelve al fence verbatim.

// Helper to detect if content is HTML
export const isHtmlContent = (content: string): boolean => {
  const htmlPattern = /<(p|div|h[1-6]|ul|ol|table|blockquote|pre|img|a|strong|em|code)[^>]*>/i;
  return htmlPattern.test(content);
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
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');

  // Inline code (single backtick). Already escaped fenced blocks above.
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => `<code>${escapeHtmlForCode(c)}</code>`);

  // Links + images
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt, url, title) => `<img src="${url}" alt="${alt || ''}"${title ? ` title="${title}"` : ''} />`);
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, text, url, title) => `<a href="${url}"${title ? ` title="${title}"` : ''}>${text}</a>`);

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

  // STEP 5 — Lists. Group consecutive bullet/ordered/task lines into a
  // single <ul>/<ol>.
  {
    const lines = html.split('\n');
    const out: string[] = [];
    type ListKind = 'ul' | 'ol' | 'task';
    let listBuffer: string[] = [];
    let listKind: ListKind | null = null;

    const flushList = () => {
      if (listBuffer.length === 0) return;
      if (listKind === 'task') {
        out.push(`<ul data-type="taskList">${listBuffer.join('')}</ul>`);
      } else if (listKind === 'ol') {
        out.push(`<ol>${listBuffer.join('')}</ol>`);
      } else {
        out.push(`<ul>${listBuffer.join('')}</ul>`);
      }
      listBuffer = [];
      listKind = null;
    };

    for (const line of lines) {
      const taskMatch = /^[ \t]*[-*+] \[([ xX])\] (.*)$/.exec(line);
      const bulletMatch = /^[ \t]*[-*+] (.*)$/.exec(line);
      const orderedMatch = /^[ \t]*(\d+)[.)] (.*)$/.exec(line);

      if (taskMatch) {
        if (listKind && listKind !== 'task') flushList();
        listKind = 'task';
        const checked = taskMatch[1].toLowerCase() === 'x';
        listBuffer.push(
          `<li data-type="taskItem" data-checked="${checked}"><p>${taskMatch[2]}</p></li>`
        );
      } else if (bulletMatch && !taskMatch) {
        if (listKind && listKind !== 'ul') flushList();
        listKind = 'ul';
        listBuffer.push(`<li>${bulletMatch[1]}</li>`);
      } else if (orderedMatch) {
        if (listKind && listKind !== 'ol') flushList();
        listKind = 'ol';
        listBuffer.push(`<li>${orderedMatch[2]}</li>`);
      } else {
        if (listKind) flushList();
        out.push(line);
      }
    }
    if (listKind) flushList();
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

  // STEP 8 — Restore code block placeholders.
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

// Prepara el contenido de un archivo para cargarlo en el editor.
export const prepareContent = (raw: string): string => {
  if (!raw) return '';
  const cleaned = healEscapedMarkdown(raw);
  if (isHtmlContent(cleaned)) return cleaned;
  return markdownToHtml(cleaned);
};
