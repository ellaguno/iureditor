// Mapa de enlaces en el editor: insertarlo (`/enlaces`) y regenerarlo desde
// la cabecera del mapa. El contenido sale de lib/mindmapLinks.ts.

import type { Editor } from '@tiptap/core';
import { vault } from './vault';
import { markdownToHtml, buildTurndownService } from './markdown';
import { buildLinkMap } from './mindmapLinks';
import { mindmapFallbackRoot } from './mindmap';
import { formatWikiLink } from './wikilinks';
import { t } from './i18n';

/** Markdown del mapa de enlaces de la nota del editor. Con índice de la
 *  bóveda: enlaces, sus enlaces y las notas que la enlazan. Sin él (nota sin
 *  guardar): sólo los wikilinks del propio documento. `shape` se conserva al
 *  regenerar. */
const linkMapMarkdown = (editor: Editor, shape: string | null): string => {
  const sourcePath: string | null = editor.storage.wikiLink?.sourcePath ?? null;
  const index = vault.index;
  const opts = { backlinksLabel: t('mindmap.backlinks'), shape };
  if (sourcePath && index?.contains(sourcePath)) {
    // Los mapas de enlaces que ya haya no cuentan: sus enlaces (subramas,
    // «enlazan aquí») saldrían como enlaces de la nota y el mapa crecería
    // con cada regeneración.
    const holder = document.createElement('div');
    holder.innerHTML = editor.getHTML();
    holder.querySelectorAll('div[data-callout="mindmap"][data-links]').forEach((el) => el.remove());
    const content = buildTurndownService().turndown(holder.innerHTML);
    return buildLinkMap(index, sourcePath, content, opts);
  }
  const seen = new Set<string>();
  const meta = shape ? `${shape} links` : 'links';
  const lines = [`> [!MINDMAP|${meta}] ${mindmapFallbackRoot(sourcePath)}`];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'callout' && node.attrs.links) return false;
    if (node.type.name !== 'wikiLink') return;
    const target = String(node.attrs.target ?? '');
    if (!target || seen.has(target)) return;
    seen.add(target);
    lines.push(`> - ${formatWikiLink({ target, heading: '', alias: '' })}`);
  });
  return lines.join('\n');
};

/** Inserta en el cursor el mapa de enlaces de la nota. */
export const insertLinkMap = (editor: Editor): void => {
  editor.chain().focus().insertContent(markdownToHtml(linkMapMarkdown(editor, null))).run();
};

/** Sustituye el mapa de enlaces en `pos` por uno recién generado (misma
 *  forma). Se deshace con Ctrl+Z. */
export const regenerateLinkMap = (editor: Editor, pos: number): void => {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const shape = (node.attrs.shape as string | null) ?? null;
  const html = markdownToHtml(linkMapMarkdown(editor, shape));
  editor
    .chain()
    .insertContentAt({ from: pos, to: pos + node.nodeSize }, html)
    .focus()
    .run();
};
