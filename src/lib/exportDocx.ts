import type { Editor } from '@tiptap/react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Math as DocxMath,
  MathRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { FileChild } from 'docx';
import { renderFullSizeDiagram } from './mermaid';
import { basename } from './fileio';

// Export a DOCX con mapper propio ProseMirror-JSON → docx (OOXML). El
// intento anterior con @turbodocx/html-to-docx producía tablas colapsadas a
// columnas de un carácter y perdía las imágenes; con docx controlamos el
// XML: tablas a ancho completo, diagramas mermaid incrustados como PNG
// (rasterizados en Rust/resvg), listas, código, citas.

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

const MONO = 'Consolas';
const CODE_BG = 'F3F4F6';
const CODE_FG = '9D174D';
const BORDER_GRAY = 'D1D5DB';
// Ancho útil A4 con márgenes de 2cm ≈ 17cm ≈ 643px a 96dpi
const CONTENT_WIDTH_PX = 620;

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

/** Dimensiones intrínsecas de una imagen (sin canvas: sólo <img>). */
const imageDims = (bytes: Uint8Array, mime: string): Promise<{ w: number; h: number }> =>
  new Promise((resolve, reject) => {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mime });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth || 600, h: img.naturalHeight || 400 });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('no se pudo medir la imagen'));
    };
    img.src = url;
  });

type DocxImageType = 'png' | 'jpg' | 'gif' | 'bmp';

const imageTypeFor = (pathOrMime: string): { type: DocxImageType; mime: string } => {
  const s = pathOrMime.toLowerCase();
  if (s.includes('jpg') || s.includes('jpeg')) return { type: 'jpg', mime: 'image/jpeg' };
  if (s.includes('gif')) return { type: 'gif', mime: 'image/gif' };
  if (s.includes('bmp')) return { type: 'bmp', mime: 'image/bmp' };
  return { type: 'png', mime: 'image/png' };
};

/** ImageRun escalado al ancho de página. displayScale divide el tamaño
 *  natural (los PNG de mermaid van rasterizados a 2x). */
const imageRunFor = async (
  bytes: Uint8Array,
  type: DocxImageType,
  mime: string,
  displayScale = 1
): Promise<ImageRun> => {
  const { w, h } = await imageDims(bytes, mime);
  let width = w / displayScale;
  let height = h / displayScale;
  if (width > CONTENT_WIDTH_PX) {
    height = (height * CONTENT_WIDTH_PX) / width;
    width = CONTENT_WIDTH_PX;
  }
  return new ImageRun({
    type,
    data: bytes,
    transformation: { width: Math.round(width), height: Math.round(height) },
  });
};

const alignFor = (attrs?: Record<string, unknown>) => {
  switch (attrs?.textAlign) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
};

const headingFor = (level: number) =>
  [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ][Math.min(Math.max(level, 1), 6) - 1];

type InlineRun = TextRun | ExternalHyperlink | FootnoteReferenceRun | DocxMath;

/** Marcas de un nodo de texto → opciones de TextRun. */
const runsFromInline = (
  nodes: PMNode[] | undefined,
  fnIds?: Map<string, number>
): InlineRun[] => {
  const out: InlineRun[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (node.type === 'mathInline') {
      // v1: el LaTeX va como ecuación de Word con el texto fuente (sin
      // conversión LaTeX→OMML; Word lo muestra en fuente matemática).
      const latex = String(node.attrs?.latex ?? '');
      out.push(new DocxMath({ children: [new MathRun(latex)] }));
      continue;
    }
    if (node.type === 'footnoteRef') {
      const label = String(node.attrs?.label ?? '');
      const id = fnIds?.get(label);
      // Siempre emite UN run (el índice ri del caso paragraph cuenta 1:1);
      // si la nota no tiene definición, va la etiqueta literal.
      out.push(id ? new FootnoteReferenceRun(id) : new TextRun({ text: `[${label}]` }));
      continue;
    }
    if (node.type !== 'text' || !node.text) continue;

    const marks = node.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    const attrOf = (t: string) => marks.find((m) => m.type === t)?.attrs;

    const isCode = has('code');
    const color = (attrOf('textStyle')?.color as string | undefined)?.replace('#', '');
    const highlight = (attrOf('highlight')?.color as string | undefined)?.replace('#', '');

    const opts = {
      text: node.text,
      bold: has('bold') || undefined,
      italics: has('italic') || undefined,
      strike: has('strike') || undefined,
      underline: has('underline') ? {} : undefined,
      subScript: has('subscript') || undefined,
      superScript: has('superscript') || undefined,
      font: isCode ? MONO : undefined,
      color: isCode ? CODE_FG : color,
      shading:
        isCode || highlight
          ? { type: ShadingType.CLEAR, fill: highlight || CODE_BG }
          : undefined,
    };

    const link = attrOf('link')?.href as string | undefined;
    if (link) {
      out.push(
        new ExternalHyperlink({
          children: [new TextRun({ ...opts, style: 'Hyperlink' })],
          link,
        })
      );
    } else {
      out.push(new TextRun(opts));
    }
  }
  return out;
};

interface Ctx {
  docDir: string | null;
  nextOlInstance: () => number;
  /** Etiqueta de nota al pie → id numérico OOXML. */
  fnIds: Map<string, number>;
}

const sep = (dir: string) => (dir.includes('\\') ? '\\' : '/');

const loadLocalImage = async (
  src: string,
  ctx: Ctx
): Promise<{ bytes: Uint8Array; type: DocxImageType; mime: string } | null> => {
  try {
    if (src.startsWith('data:')) {
      const m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(src);
      if (!m) return null;
      const { type, mime } = imageTypeFor(m[1]);
      return { bytes: base64ToBytes(m[2]), type, mime };
    }
    if (/^[a-z]+:\/\//i.test(src)) return null; // remotas: fuera de alcance v1
    if (!ctx.docDir) return null;
    const s = sep(ctx.docDir);
    const abs = `${ctx.docDir}${s}${src.replaceAll('/', s)}`;
    const bytes = await readFile(abs);
    if (src.toLowerCase().endsWith('.svg')) {
      const svg = new TextDecoder().decode(bytes);
      const b64 = await invoke<string>('render_svg_png', { svg, scale: 2 });
      return { bytes: base64ToBytes(b64), type: 'png', mime: 'image/png' };
    }
    const { type, mime } = imageTypeFor(src);
    return { bytes, type, mime };
  } catch (err) {
    console.error(`No se pudo cargar la imagen ${src}:`, err);
    return null;
  }
};

const codeBlockParagraphs = (code: string): Paragraph[] => {
  const lines = code.replace(/\n$/, '').split('\n');
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
        spacing: {
          before: i === 0 ? 120 : 0,
          after: i === lines.length - 1 ? 120 : 0,
          line: 240,
        },
        keepLines: true,
      })
  );
};

/** Convierte un bloque ProseMirror en elementos docx. Recursivo y async
 *  (imágenes y mermaid). */
const blockToDocx = async (
  node: PMNode,
  ctx: Ctx,
  listOpts?: {
    kind: 'ul' | 'ol' | 'task';
    level: number;
    instance: number;
    checked?: boolean;
  }
): Promise<FileChild[]> => {
  switch (node.type) {
    case 'paragraph': {
      const runs = runsFromInline(node.content, ctx.fnIds);
      // Imágenes inline dentro del párrafo
      const children: (InlineRun | ImageRun)[] = [];
      let ri = 0;
      for (const child of node.content ?? []) {
        if (child.type === 'image') {
          const src = (child.attrs?.src as string) || '';
          const img = await loadLocalImage(src, ctx);
          if (img) children.push(await imageRunFor(img.bytes, img.type, img.mime));
        } else if (
          child.type === 'text' ||
          child.type === 'hardBreak' ||
          child.type === 'footnoteRef' ||
          child.type === 'mathInline'
        ) {
          if (runs[ri]) children.push(runs[ri]);
          ri++;
        }
      }
      if (listOpts?.kind === 'task') {
        children.unshift(new TextRun({ text: listOpts.checked ? '☑ ' : '☐ ' }));
      }
      const para = new Paragraph({
        children,
        alignment: alignFor(node.attrs),
        spacing: { after: listOpts ? 60 : 120 },
        ...(listOpts?.kind === 'ol'
          ? { numbering: { reference: 'iur-ol', level: listOpts.level, instance: listOpts.instance } }
          : {}),
        ...(listOpts?.kind === 'ul' ? { bullet: { level: listOpts.level } } : {}),
        ...(listOpts?.kind === 'task'
          ? { indent: { left: 360 + listOpts.level * 360 } }
          : {}),
      });
      return [para];
    }

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      return [
        new Paragraph({
          children: runsFromInline(node.content, ctx.fnIds),
          heading: headingFor(level),
          alignment: alignFor(node.attrs),
          spacing: { before: 240, after: 120 },
        }),
      ];
    }

    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const kind = node.type === 'orderedList' ? 'ol' : node.type === 'taskList' ? 'task' : 'ul';
      const level = listOpts ? listOpts.level + 1 : 0;
      const instance = kind === 'ol' ? ctx.nextOlInstance() : 0;
      const out: FileChild[] = [];
      for (const item of node.content ?? []) {
        const checked = item.attrs?.checked === true;
        let first = true;
        for (const child of item.content ?? []) {
          if (child.type === 'paragraph' && first) {
            out.push(
              ...(await blockToDocx(child, ctx, { kind, level, instance, checked }))
            );
            first = false;
          } else if (
            child.type === 'bulletList' ||
            child.type === 'orderedList' ||
            child.type === 'taskList'
          ) {
            out.push(...(await blockToDocx(child, ctx, { kind, level, instance })));
          } else {
            out.push(...(await blockToDocx(child, ctx)));
          }
        }
      }
      return out;
    }

    case 'codeBlock':
      return codeBlockParagraphs(node.content?.map((c) => c.text ?? '').join('') ?? '');

    case 'mermaid': {
      const code = ((node.attrs?.code as string) || '').trim();
      if (!code) return [];
      try {
        const svg = await renderFullSizeDiagram(code);
        const b64 = await invoke<string>('render_svg_png', { svg, scale: 2 });
        const bytes = base64ToBytes(b64);
        const run = await imageRunFor(bytes, 'png', 'image/png', 2);
        return [
          new Paragraph({
            children: [run],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        ];
      } catch (err) {
        console.error('Mermaid → PNG falló, va como código:', err);
        return codeBlockParagraphs(code);
      }
    }

    case 'mathBlock': {
      const latex = String(node.attrs?.latex ?? '').trim();
      if (!latex) return [];
      return [
        new Paragraph({
          children: [new DocxMath({ children: [new MathRun(latex)] })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
        }),
      ];
    }

    case 'blockquote': {
      const out: FileChild[] = [];
      for (const child of node.content ?? []) {
        if (child.type === 'paragraph') {
          out.push(
            new Paragraph({
              children: runsFromInline(child.content, ctx.fnIds),
              indent: { left: 480 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 18, color: BORDER_GRAY, space: 8 },
              },
              spacing: { after: 60 },
            })
          );
        } else {
          out.push(...(await blockToDocx(child, ctx)));
        }
      }
      return out;
    }

    case 'horizontalRule':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_GRAY } },
          spacing: { before: 120, after: 120 },
        }),
      ];

    case 'table': {
      const rows: TableRow[] = [];
      let isFirst = true;
      for (const row of node.content ?? []) {
        const cells: TableCell[] = [];
        for (const cell of row.content ?? []) {
          const cellChildren: FileChild[] = [];
          for (const child of cell.content ?? []) {
            cellChildren.push(...(await blockToDocx(child, ctx)));
          }
          const isHeader = cell.type === 'tableHeader' || isFirst;
          cells.push(
            new TableCell({
              children: cellChildren.length
                ? (cellChildren as Paragraph[])
                : [new Paragraph('')],
              columnSpan: (cell.attrs?.colspan as number) || undefined,
              shading: isHeader
                ? { type: ShadingType.CLEAR, fill: 'F3F4F6' }
                : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            })
          );
        }
        rows.push(new TableRow({ children: cells, cantSplit: true, tableHeader: isFirst }));
        isFirst = false;
      }
      return [
        new Table({
          rows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }),
        new Paragraph({ spacing: { after: 120 } }),
      ];
    }

    case 'image': {
      const src = (node.attrs?.src as string) || '';
      const img = await loadLocalImage(src, ctx);
      if (!img) return [];
      return [
        new Paragraph({
          children: [await imageRunFor(img.bytes, img.type, img.mime)],
          spacing: { before: 120, after: 120 },
        }),
      ];
    }

    default: {
      // Nodo desconocido con contenido: procesa los hijos.
      if (node.content?.length) {
        const out: FileChild[] = [];
        for (const child of node.content) out.push(...(await blockToDocx(child, ctx)));
        return out;
      }
      return [];
    }
  }
};

/** Construye el Document docx desde el JSON de ProseMirror. Exportado para
 *  poder testearlo sin editor ni diálogos. */
export const buildDocxDocument = async (
  json: PMNode,
  docDir: string | null,
  title: string
): Promise<Document> => {
  let olCounter = 0;

  // Pre-pass: definiciones de notas al pie → ids OOXML en orden de aparición.
  const fnDefs: PMNode[] = [];
  const collectDefs = (node: PMNode) => {
    if (node.type === 'footnoteDef') fnDefs.push(node);
    node.content?.forEach(collectDefs);
  };
  (json.content ?? []).forEach(collectDefs);
  const fnIds = new Map<string, number>();
  fnDefs.forEach((def, i) => {
    const label = String(def.attrs?.label ?? '');
    if (!fnIds.has(label)) fnIds.set(label, i + 1);
  });

  const ctx: Ctx = {
    docDir,
    nextOlInstance: () => ++olCounter,
    fnIds,
  };

  // Contenido de cada nota (el texto de la definición, con sus marcas).
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  for (const def of fnDefs) {
    const id = fnIds.get(String(def.attrs?.label ?? ''))!;
    if (footnotes[id]) continue;
    footnotes[id] = {
      children: [new Paragraph({ children: runsFromInline(def.content, fnIds) })],
    };
  }

  const children: FileChild[] = [];
  for (const node of json.content ?? []) {
    // Las definiciones no van en el cuerpo: Word las coloca al pie de página.
    if (node.type === 'footnoteDef') continue;
    children.push(...(await blockToDocx(node, ctx)));
  }

  return new Document({
    title,
    footnotes,
    numbering: {
      config: [
        {
          reference: 'iur-ol',
          levels: [0, 1, 2, 3, 4, 5].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 } },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
        },
        children,
      },
    ],
  });
};

export const exportToDocx = async (editor: Editor, filePath: string | null): Promise<void> => {
  const title = filePath
    ? basename(filePath).replace(/\.(md|markdown)$/i, '')
    : 'documento';

  const path = await save({
    defaultPath: `${title}.docx`,
    filters: [{ name: 'Word', extensions: ['docx'] }],
  });
  if (!path) return;

  const docDir = filePath
    ? filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')))
    : null;
  const doc = await buildDocxDocument(editor.getJSON() as PMNode, docDir, title);

  const blob = await Packer.toBlob(doc);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
};
