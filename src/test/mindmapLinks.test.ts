import { describe, it, expect } from 'vitest';
import { VaultIndex } from '../lib/vaultIndex';
import { buildLinkMap } from '../lib/mindmapLinks';

const vaultWith = (notes: Record<string, string>) => {
  const v = new VaultIndex('/v');
  for (const [path, content] of Object.entries(notes)) v.upsert(path, content, 1);
  return v;
};

describe('mapa de enlaces', () => {
  const v = vaultWith({
    '/v/Inicio.md': 'Ver [[Proyecto]], [[ideas/Idea|una idea]] y [[Falta]]. Otra vez [[Proyecto]].',
    '/v/Proyecto.md': 'Volver a [[Inicio]]. Ver [[Tareas]] y ![[plano.png]].',
    '/v/ideas/Idea.md': 'Enlaza [[Proyecto]].',
    '/v/Tareas.md': 'Nada.',
    '/v/Diario.md': 'Hoy revisé [[Inicio]].',
  });
  v.setAttachments(['/v/plano.png']);

  it('centro, enlaces, sus enlaces y quién enlaza aquí', () => {
    const md = buildLinkMap(v, '/v/Inicio.md', v.get('/v/Inicio.md')!.content, {
      backlinksLabel: 'Enlazan aquí',
    });
    expect(md).toBe(
      [
        '> [!MINDMAP] Inicio',
        '> - [[Proyecto]]',
        // Sin volver al centro ni adjuntos.
        '>   - [[Tareas]]',
        '> - [[Idea]]',
        '>   - [[Proyecto]]',
        // [[Falta]] no existe: fuera.
        '> - Enlazan aquí',
        '>   - [[Diario]]',
        '>   - [[Proyecto]]',
      ].join('\n')
    );
  });

  it('usa el texto actual del editor, no el guardado', () => {
    const md = buildLinkMap(v, '/v/Inicio.md', 'Sólo [[Tareas]].', { backlinksLabel: 'B' });
    expect(md.split('\n').slice(0, 2)).toEqual(['> [!MINDMAP] Inicio', '> - [[Tareas]]']);
  });

  it('respeta los topes', () => {
    const md = buildLinkMap(v, '/v/Inicio.md', v.get('/v/Inicio.md')!.content, {
      backlinksLabel: 'B',
      maxBranches: 1,
      maxSub: 0,
    });
    expect(md).toBe('> [!MINDMAP] Inicio\n> - [[Proyecto]]');
  });
});
