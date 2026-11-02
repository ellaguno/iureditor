// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { generateJSON, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Callout } from '../extensions/callout';
import { WikiLink } from '../extensions/wikiLink';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';
import { mindmapFromCallout as fromCallout, mindmapFallbackRoot, isMindmapCallout } from '../lib/mindmap';
import type { MindmapJson } from '../lib/mindmap';
import { nodeAt, addChild, addSibling, removeNode, canRemove, labelRange } from '../lib/mindmapEdit';

const TIDY = '---\nconfig:\n  layout: tidy-tree\n---\n';
/** Código sin el encabezado de acomodo (se prueba aparte). */
const mindmapFromCallout = (...args: Parameters<typeof fromCallout>) => {
  const r = fromCallout(...args);
  return { ...r, code: r.code.startsWith(TIDY) ? r.code.slice(TIDY.length) : `SIN-ENCABEZADO\n${r.code}` };
};

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

  it('pide el acomodo en árbol', () => {
    expect(fromCallout(firstCallout('> [!MINDMAP] C\n> - x'), 'n').code.startsWith(TIDY)).toBe(true);
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

describe('mapa mental: forma de los nodos', () => {
  const md = '> [!MINDMAP|bang] Centro\n> - Rama (uno)\n>   - Sub';

  it('el metadato `|forma` llega al callout y vuelve igual al guardar', () => {
    const callout = firstCallout(md);
    expect(callout.attrs).toMatchObject({ type: 'mindmap', shape: 'bang' });
    const saved = buildTurndownService().turndown(generateHTML(docOf(md), extensions));
    expect(saved).toContain('> [!MINDMAP|bang] Centro');
  });

  it('cada nodo lleva id y los delimitadores de su forma', () => {
    expect(mindmapFromCallout(firstCallout(md), 'n').code).toBe(
      ['mindmap', '  n0))Centro((', '    n1))Rama （uno）((', '      n2))Sub(('].join('\n')
    );
    const square = firstCallout(md.replace('|bang', '|square'));
    expect(mindmapFromCallout(square, 'n').code.split('\n')[1]).toBe('  n0[Centro]');
  });

  it('`|forma links` marca un mapa de enlaces y vuelve igual al guardar', () => {
    const src = '> [!MINDMAP|bang links] Centro\n> - [[A]]';
    expect(firstCallout(src).attrs).toMatchObject({ shape: 'bang', links: true });
    expect(firstCallout('> [!MINDMAP|links] C\n> - x').attrs).toMatchObject({ shape: null, links: true });
    const saved = buildTurndownService().turndown(generateHTML(docOf(src), extensions));
    expect(saved).toContain('> [!MINDMAP|bang links] Centro');
  });

  it('una forma desconocida cae en la de por omisión; otros callouts no aceptan metadato', () => {
    expect(mindmapFromCallout(firstCallout(md.replace('|bang', '|rara')), 'n').code.split('\n')[1]).toBe(
      '  Centro'
    );
    expect(markdownToHtml('> [!NOTE|x] hola')).not.toContain('data-callout');
  });
});

describe('mapa mental: edición desde el dibujo', () => {
  const MD = '> [!MINDMAP] Centro\n> - Rama 1\n>   - Sub 1.1\n> - Rama 2';

  const setup = async (md = MD) => {
    const { Editor } = await import('@tiptap/core');
    const editor = new Editor({ extensions, content: markdownToHtml(md) });
    // El callout es el primer bloque: posición 0.
    const map = () => {
      const callout = editor.state.doc.child(0);
      return { callout, ...mindmapFromCallout(callout.toJSON(), 'n') };
    };
    const saved = () => buildTurndownService().turndown(editor.getHTML());
    return { editor, map, saved };
  };

  it('cada nodo sabe de qué bloque sale y el cursor lo identifica', async () => {
    const { editor, map } = await setup();
    const { callout, nodes } = map();
    expect(nodes.map((n) => n.kind)).toEqual(['root', 'item', 'item', 'item']);
    const texts = nodes.map((ref) => {
      const r = labelRange(callout, 0, ref)!;
      return editor.state.doc.textBetween(r.from, r.to);
    });
    expect(texts).toEqual(['Centro', 'Rama 1', 'Sub 1.1', 'Rama 2']);
    const r = labelRange(callout, 0, nodes[2])!;
    expect(nodeAt(callout, 0, nodes, r.from + 1)).toBe(2);
    expect(canRemove(nodes[0])).toBe(false);
    editor.destroy();
  });

  it('rama hija, rama hermana y eliminar editan la lista', async () => {
    const { editor, map, saved } = await setup();
    let m = map();
    addChild(editor, m.callout, 0, m.nodes[3]); // hija de «Rama 2»
    editor.commands.insertContent('Sub 2.1');
    m = map();
    addSibling(editor, m.callout, 0, m.nodes[1]); // hermana de «Rama 1»
    editor.commands.insertContent('Rama 1b');
    m = map();
    addChild(editor, m.callout, 0, m.nodes[0]); // desde el centro: primer nivel
    editor.commands.insertContent('Rama 3');
    expect(saved()).toBe(
      '> [!MINDMAP] Centro\n> - Rama 1\n>   - Sub 1.1\n> - Rama 1b\n> - Rama 2\n>   - Sub 2.1\n> - Rama 3'
    );
    m = map();
    removeNode(editor, m.callout, 0, m.nodes[2]); // «Sub 1.1», única hija: se va la sublista
    m = map();
    removeNode(editor, m.callout, 0, m.nodes[3]); // «Rama 2» con su hija
    expect(saved()).toBe('> [!MINDMAP] Centro\n> - Rama 1\n> - Rama 1b\n> - Rama 3');
    editor.destroy();
  });

  it('sin lista, la primera rama crea la lista tras el centro', async () => {
    const { editor, map, saved } = await setup('> [!MINDMAP] Solo centro');
    const m = map();
    addChild(editor, m.callout, 0, m.nodes[0]);
    editor.commands.insertContent('Primera');
    expect(saved()).toBe('> [!MINDMAP] Solo centro\n> - Primera');
    editor.destroy();
  });
});
