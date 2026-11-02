// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateJSON, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Callout } from '../extensions/callout';
import { WikiLink } from '../extensions/wikiLink';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';
import { mindmapFromCallout, mindmapFallbackRoot, isMindmapCallout } from '../lib/mindmap';
import type { MindmapJson } from '../lib/mindmap';

const extensions = [StarterKit.configure({ link: false }), Callout, WikiLink];

/** Markdown → JSON del documento tal como lo tiene el editor. */
const docOf = (md: string): MindmapJson => generateJSON(markdownToHtml(md), extensions);
const firstCallout = (md: string): MindmapJson => docOf(md).content![0];

describe('mapa mental: markdown', () => {
  const md = [
    '> [!MINDMAP] Centro',
    '> - Rama 1',
    '>   - Subrama 1.1',
    '>     - Subrama 1.1.1',
    '> - Rama 2 [[Otra nota|la otra]]',
  ].join('\n');

  it('`> [!MINDMAP]` es un callout de tipo mindmap', () => {
    const callout = firstCallout(md);
    expect(isMindmapCallout(callout)).toBe(true);
  });

  it('sobrevive a abrir → guardar → abrir', () => {
    const html = generateHTML(docOf(md), extensions);
    const saved = buildTurndownService().turndown(html);
    expect(saved).toContain('> [!MINDMAP] Centro\n> - Rama 1');
    expect(saved).toContain('[[Otra nota|la otra]]');
    expect(docOf(saved)).toEqual(docOf(md));
  });
});

describe('mapa mental: código mermaid', () => {
  it('centro, ramas anidadas y wikilinks por índice de nodo', () => {
    const { code, links } = mindmapFromCallout(
      firstCallout(
        [
          '> [!MINDMAP] Centro',
          '> - Rama 1',
          '>   - Subrama 1.1',
          '>     - Subrama 1.1.1',
          '> - Rama 2 [[Otra nota|la otra]]',
        ].join('\n')
      ),
      'nota'
    );
    expect(code).toBe(
      [
        'mindmap',
        '  Centro',
        '    Rama 1',
        '      Subrama 1.1',
        '        Subrama 1.1.1',
        '    Rama 2 la otra',
      ].join('\n')
    );
    expect([...links.keys()]).toEqual([4]);
    expect(links.get(4)).toMatchObject({ target: 'Otra nota', alias: 'la otra' });
  });

  it('sin centro usa el nombre de la nota', () => {
    const callout = firstCallout('> [!MINDMAP]\n> - Una\n> - Dos');
    const { code } = mindmapFromCallout(callout, mindmapFallbackRoot('/a/b/Mi nota.md'));
    expect(code.split('\n')[1]).toBe('  Mi nota');
  });

  it('negrita y cursiva como markdown; caracteres de forma neutralizados', () => {
    const callout = firstCallout('> [!MINDMAP] Centro\n> - **Fuerte** y *suave* (nota) [x] a*b');
    const { code } = mindmapFromCallout(callout, 'n');
    expect(code.split('\n')[2]).toBe('    **Fuerte** y *suave* （nota） ［x］ a∗b');
  });

  it('un elemento vacío no rompe la jerarquía', () => {
    const callout: MindmapJson = {
      type: 'callout',
      attrs: { type: 'mindmap' },
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph' },
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hijo' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(mindmapFromCallout(callout, 'C').code).toBe(
      ['mindmap', '  C', '    …', '      hijo'].join('\n')
    );
  });
});

describe('mapa mental: convertir una lista', () => {
  const editorWith = async (md: string) => {
    const { Editor } = await import('@tiptap/core');
    return new Editor({ extensions, content: markdownToHtml(md) });
  };
  const textPos = (editor: { state: { doc: { descendants: (f: (n: { isText: boolean; text?: string }, p: number) => void) => void } } }, text: string) => {
    let pos = -1;
    editor.state.doc.descendants((n, p) => {
      if (pos < 0 && n.isText && n.text?.includes(text)) pos = p + 1;
    });
    return pos;
  };

  it('envuelve la lista entera con el párrafo previo como centro, y lo deshace', async () => {
    const md = 'Antes.\n\nCentro\n\n- Rama 1\n  - Sub 1.1\n- Rama 2\n\nDespués.';
    const editor = await editorWith(md);
    editor.commands.setTextSelection(textPos(editor, 'Sub 1.1'));
    editor.commands.toggleMindmap();
    const doc = editor.getJSON();
    expect(doc.content!.map((b) => b.type)).toEqual(['paragraph', 'callout', 'paragraph']);
    const { code } = mindmapFromCallout(doc.content![1], 'n');
    expect(code).toBe('mindmap\n  Centro\n    Rama 1\n      Sub 1.1\n    Rama 2');

    editor.commands.setTextSelection(textPos(editor, 'Rama 2'));
    editor.commands.toggleMindmap();
    expect(editor.getJSON()).toEqual((await editorWith(md)).getJSON());
    editor.destroy();
  });
});
