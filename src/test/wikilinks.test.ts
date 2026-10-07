import { describe, it, expect } from 'vitest';
import {
  parseWikiInner,
  formatWikiLink,
  wikiDisplay,
  scanLinks,
  rewriteLinks,
  retargetMdLink,
} from '../lib/wikilinks';
import { VaultIndex } from '../lib/vaultIndex';
import { fuzzyScore, fuzzyFilter } from '../lib/fuzzy';

describe('wikilinks: parseo y formato', () => {
  it('separa destino, sección y alias', () => {
    expect(parseWikiInner('Nota')).toMatchObject({ target: 'Nota', heading: '', alias: '' });
    expect(parseWikiInner('a/Nota#Sección 2|ver')).toMatchObject({
      target: 'a/Nota',
      heading: 'Sección 2',
      alias: 'ver',
    });
    expect(parseWikiInner('#Arriba')).toMatchObject({ target: '', heading: 'Arriba' });
  });

  it('acepta el alias escapado de las tablas', () => {
    const p = parseWikiInner('Nota\\|alias');
    expect(p).toMatchObject({ target: 'Nota', alias: 'alias', aliasSep: '\\|' });
    expect(formatWikiLink(p, { aliasSep: p.aliasSep })).toBe('[[Nota\\|alias]]');
  });

  it('formatea y muestra', () => {
    const parts = { target: 'Nota', heading: 'Uno', alias: '' };
    expect(formatWikiLink(parts)).toBe('[[Nota#Uno]]');
    expect(formatWikiLink(parts, { embed: true })).toBe('![[Nota#Uno]]');
    expect(wikiDisplay(parts)).toBe('Nota › Uno');
    expect(wikiDisplay({ ...parts, alias: 'x' })).toBe('x');
  });
});

describe('scanLinks', () => {
  it('encuentra wikilinks y enlaces markdown a .md con su línea', () => {
    const md = 'Ver [[Uno]].\n\nY [dos](sub/Dos%20b.md#parte) y [web](https://x.com/a.md).\n![[foto.png]]';
    const links = scanLinks(md);
    expect(links.map((l) => [l.kind, l.target, l.line])).toEqual([
      ['wiki', 'Uno', 1],
      ['md', 'sub/Dos b.md', 3],
      ['wiki', 'foto.png', 4],
    ]);
    expect(links[1].heading).toBe('parte');
    expect(links[2].embed).toBe(true);
  });

  it('ignora código y front matter', () => {
    const md = '---\nrel: "[[No]]"\n---\n\n`[[Tampoco]]`\n\n```\n[[Nada]]\n```\n\n[[Si]]';
    expect(scanLinks(md).map((l) => l.target)).toEqual(['Si']);
  });

  it('no cuenta imágenes ni anclas internas como enlaces a notas', () => {
    expect(scanLinks('![x](a.md) [y](#sec) [z](a.png)')).toEqual([]);
  });

  it('rewriteLinks sustituye sólo lo pedido', () => {
    const md = '[[A]] y [[B|be]]';
    const out = rewriteLinks(md, (occ) =>
      occ.target === 'B' ? formatWikiLink({ ...occ, target: 'C' }) : null
    );
    expect(out).toBe('[[A]] y [[C|be]]');
  });

  it('retargetMdLink conserva texto, ancla y título', () => {
    expect(retargetMdLink('[t](a.md#x "tít")', 'b c.md')).toBe('[t](b%20c.md#x "tít")');
  });
});

const vault = () => {
  const v = new VaultIndex('/v');
  v.upsert('/v/Inicio.md', '# Inicio\n\nVer [[Proyecto]] y [[ideas/Idea|una idea]].\nTambién [notas](ideas/Idea.md).', 1);
  v.upsert('/v/Proyecto.md', '# Proyecto\n## Plan\nVolver a [[Inicio#Inicio]]. Menciono Idea aquí.', 1);
  v.upsert('/v/ideas/Idea.md', '# Idea\nEnlace a [[Proyecto]] y a [[Falta]].', 1);
  v.upsert('/v/otra/Proyecto.md', 'Duplicado', 1);
  return v;
};

describe('VaultIndex', () => {
  it('resuelve por nombre prefiriendo la carpeta de origen', () => {
    const v = vault();
    expect(v.resolve('Proyecto', '/v/Inicio.md')).toBe('/v/Proyecto.md');
    expect(v.resolve('Proyecto', '/v/otra/X.md')).toBe('/v/otra/Proyecto.md');
    expect(v.resolve('proyecto', '/v/ideas/Idea.md')).toBe('/v/Proyecto.md'); // ruta más corta
    expect(v.resolve('Falta', '/v/Inicio.md')).toBeNull();
  });

  it('resuelve rutas relativas a la bóveda y sufijos', () => {
    const v = vault();
    expect(v.resolve('ideas/Idea', null)).toBe('/v/ideas/Idea.md');
    expect(v.resolve('otra/Proyecto.md', null)).toBe('/v/otra/Proyecto.md');
    expect(v.resolve('', '/v/Proyecto.md')).toBe('/v/Proyecto.md');
  });

  it('adjuntos', () => {
    const v = vault();
    v.setAttachments(['/v/img/foto.png']);
    expect(v.resolve('foto.png', '/v/Inicio.md')).toBe('/v/img/foto.png');
    expect(v.resolve('v1.2', null)).toBeNull();
  });

  it('backlinks cuenta wikilinks y enlaces markdown', () => {
    const v = vault();
    const back = v.backlinks('/v/ideas/Idea.md');
    expect(back.map((b) => [b.source.rel, b.links.length])).toEqual([['Inicio.md', 2]]);
    expect(v.backlinks('/v/Proyecto.md').map((b) => b.source.rel)).toEqual([
      'ideas/Idea.md',
      'Inicio.md',
    ]);
  });

  it('enlaces salientes resueltos y sin resolver', () => {
    const out = vault().outgoing('/v/ideas/Idea.md');
    expect(out.map((o) => [o.occ.target, o.path])).toEqual([
      ['Proyecto', '/v/Proyecto.md'],
      ['Falta', null],
    ]);
  });

  it('menciones sin enlazar', () => {
    const m = vault().unlinkedMentions('/v/ideas/Idea.md');
    expect(m.map((x) => x.source.rel)).toEqual(['Proyecto.md']);
    expect(m[0].lines[0].line).toBe(3);
  });

  it('texto de enlace más corto', () => {
    const v = vault();
    expect(v.linkTextFor('/v/ideas/Idea.md', '/v/Inicio.md')).toBe('Idea');
    expect(v.linkTextFor('/v/otra/Proyecto.md', '/v/Inicio.md')).toBe('otra/Proyecto');
  });

  it('planifica el renombrado conservando alias, secciones y estilo', () => {
    const v = vault();
    const edits = v.planRename('/v/ideas/Idea.md', '/v/ideas/Gran idea.md');
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe('/v/Inicio.md');
    expect(edits[0].count).toBe(2);
    expect(edits[0].content).toBe(
      '# Inicio\n\nVer [[Proyecto]] y [[ideas/Gran idea|una idea]].\nTambién [notas](ideas/Gran%20idea.md).'
    );
  });

  it('renombrar a un nombre ambiguo usa la ruta', () => {
    const v = vault();
    const edits = v.planRename('/v/Inicio.md', '/v/Portada.md');
    expect(edits.map((e) => e.content.match(/\[\[Portada[^\]]*\]\]/)?.[0])).toEqual(['[[Portada#Inicio]]']);
    // «Proyecto» ya existe en dos carpetas: el enlace pasa a la ruta.
    const amb = v.planRename('/v/ideas/Idea.md', '/v/ideas/Proyecto.md');
    expect(amb[0].content).toContain('[[ideas/Proyecto|una idea]]');
  });

  it('applyRename mueve la entrada', () => {
    const v = vault();
    v.applyRename('/v/ideas/Idea.md', '/v/ideas/Otra.md', 2);
    expect(v.get('/v/ideas/Idea.md')).toBeUndefined();
    expect(v.get('/v/ideas/Otra.md')?.name).toBe('Otra');
  });
});

describe('fuzzy', () => {
  it('subcadena gana a dispersa y descarta lo que no coincide', () => {
    expect(fuzzyScore('pro', 'Proyecto')).not.toBeNull();
    expect(fuzzyScore('pyt', 'Proyecto')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Proyecto')).toBeNull();
    expect(fuzzyScore('pro', 'Proyecto')!).toBeGreaterThan(fuzzyScore('pyt', 'Proyecto')!);
  });

  it('ignora acentos y ordena', () => {
    const items = ['notas/canción.md', 'cancelar.md', 'otro.md'];
    expect(fuzzyFilter(items, 'cancion', (s) => s)).toEqual(['notas/canción.md']);
    expect(fuzzyFilter(items, 'canc', (s) => s)[0]).toBe('cancelar.md');
  });
});
