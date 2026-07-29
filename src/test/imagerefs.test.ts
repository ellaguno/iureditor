import { describe, it, expect } from 'vitest';
import {
  extractImageSrcs,
  isRelativeImg,
  rewriteImageSrcs,
  encodeImgSrc,
  decodeImgSrc,
  isInsideDir,
  relativeFrom,
} from '../lib/imageRefs';
import { joinAndNormalize } from '../extensions/imageResolve';

// Lógica que decide a dónde va cada imagen cuando un «guardar como» muda el
// documento de carpeta. Si esto se rompe, el documento se guarda con imágenes
// que no resuelven.

describe('extractImageSrcs', () => {
  it('encuentra imágenes markdown y HTML, sin repetir', () => {
    const md = [
      '![logo](assets/logo.png)',
      '<img src="assets/foto.jpg" alt="x">',
      'otra vez ![logo](assets/logo.png)',
      '![remota](https://example.com/a.png)',
    ].join('\n\n');
    expect(extractImageSrcs(md)).toEqual([
      'assets/logo.png',
      'https://example.com/a.png',
      'assets/foto.jpg',
    ]);
  });

  it('admite título y paréntesis angulares en la forma markdown', () => {
    expect(extractImageSrcs('![a](<assets/l.png> "Un título")')).toEqual(['assets/l.png']);
  });

  it('no confunde un enlace normal con una imagen', () => {
    expect(extractImageSrcs('[no soy imagen](assets/doc.md)')).toEqual([]);
  });

  it('ignora los ejemplos dentro de bloques de código', () => {
    const md = [
      '![real](assets/real.png)',
      '```markdown',
      '![ejemplo](assets/ejemplo.png)',
      '```',
      'y en línea: `![otro](assets/otro.png)`',
      '~~~',
      '<img src="assets/tilde.png">',
      '~~~',
    ].join('\n');
    expect(extractImageSrcs(md)).toEqual(['assets/real.png']);
  });
});

describe('isRelativeImg', () => {
  it('acepta rutas relativas al documento', () => {
    expect(isRelativeImg('assets/logo.png')).toBe(true);
    expect(isRelativeImg('../instance/img.png')).toBe(true);
  });

  it('rechaza lo que no vive junto al documento', () => {
    for (const src of [
      'https://example.com/a.png',
      '//cdn/a.png',
      'data:image/png;base64,AAAA',
      'asset://localhost/a.png',
      '/home/u/abs.png',
      'C:\\Users\\u\\abs.png',
    ]) {
      expect(isRelativeImg(src), src).toBe(false);
    }
  });
});

describe('rewriteImageSrcs', () => {
  it('sustituye sólo el src, dejando alt y título intactos', () => {
    const md = '![El logo](assets/logo.png "Título")';
    const out = rewriteImageSrcs(md, new Map([['assets/logo.png', '../viejo/assets/logo.png']]));
    expect(out).toBe('![El logo](../viejo/assets/logo.png "Título")');
  });

  it('no toca el alt aunque repita el texto del src', () => {
    const md = '![assets/logo.png](assets/logo.png)';
    const out = rewriteImageSrcs(md, new Map([['assets/logo.png', 'otra/logo.png']]));
    expect(out).toBe('![assets/logo.png](otra/logo.png)');
  });

  it('conserva los demás atributos de un <img>', () => {
    const html = '<img class="w-4" src="assets/a.png" alt="a">';
    const out = rewriteImageSrcs(html, new Map([['assets/a.png', '../a.png']]));
    expect(out).toBe('<img class="w-4" src="../a.png" alt="a">');
  });

  it('deja intacto lo que no está en el mapa', () => {
    const md = '![a](assets/a.png) ![b](assets/b.png)';
    const out = rewriteImageSrcs(md, new Map([['assets/a.png', 'x/a.png']]));
    expect(out).toBe('![a](x/a.png) ![b](assets/b.png)');
  });

  it('sin reescrituras devuelve el contenido tal cual', () => {
    const md = '![a](assets/a.png)';
    expect(rewriteImageSrcs(md, new Map())).toBe(md);
  });

  it('no corrompe un ejemplo dentro de un bloque de código', () => {
    const md = [
      '![real](assets/a.png)',
      '',
      '```markdown',
      '![ejemplo](assets/a.png)',
      '```',
      '',
      'en línea: `![otro](assets/a.png)`',
    ].join('\n');
    const out = rewriteImageSrcs(md, new Map([['assets/a.png', '../docs/assets/a.png']]));
    expect(out).toContain('![real](../docs/assets/a.png)');
    expect(out).toContain('![ejemplo](assets/a.png)');
    expect(out).toContain('`![otro](assets/a.png)`');
  });
});

describe('encodeImgSrc / decodeImgSrc', () => {
  it('escapa lo que rompería el enlace markdown', () => {
    expect(encodeImgSrc('../mis fotos/a (1).png')).toBe('../mis%20fotos/a%20%281%29.png');
  });

  it('el markdown reescrito no vuelve a partirse al releerlo', () => {
    const src = encodeImgSrc('../mis fotos/a (1).png');
    expect(extractImageSrcs(`![x](${src})`)).toEqual([src]);
  });

  it('decodifica para buscar en disco y aguanta escapes inválidos', () => {
    expect(decodeImgSrc('assets/mi%20foto.png')).toBe('assets/mi foto.png');
    expect(decodeImgSrc('assets/100%.png')).toBe('assets/100%.png');
  });
});

describe('isInsideDir', () => {
  const dir = '/home/u/docs';
  it('reconoce lo que cuelga de la carpeta del documento', () => {
    expect(isInsideDir(dir, joinAndNormalize(dir, 'assets/logo.png'))).toBe(true);
    expect(isInsideDir(dir, joinAndNormalize(dir, 'a/b/c/img.png'))).toBe(true);
  });

  it('reconoce lo que se sale de ella', () => {
    expect(isInsideDir(dir, joinAndNormalize(dir, '../instance/img.png'))).toBe(false);
    expect(isInsideDir(dir, '/home/u/otra/img.png')).toBe(false);
    // Un prefijo de texto no es un prefijo de ruta.
    expect(isInsideDir(dir, '/home/u/docs-viejos/img.png')).toBe(false);
    expect(isInsideDir(dir, dir)).toBe(false);
  });
});

describe('relativeFrom', () => {
  it('sube y baja lo justo', () => {
    expect(relativeFrom('/home/u/otra', '/home/u/docs/assets/logo.png')).toBe(
      '../docs/assets/logo.png'
    );
    expect(relativeFrom('/home/u/docs', '/home/u/docs/assets/logo.png')).toBe(
      'assets/logo.png'
    );
    expect(relativeFrom('/home/u/a/b/c', '/home/u/img.png')).toBe('../../../img.png');
  });

  it('sin raíz común no hay relativa (unidades distintas en Windows)', () => {
    expect(relativeFrom('C:/docs', 'D:/fotos/a.png')).toBeNull();
  });

  it('es la inversa de joinAndNormalize', () => {
    const from = '/home/u/otra';
    const target = '/home/u/docs/assets/logo.png';
    expect(joinAndNormalize(from, relativeFrom(from, target)!)).toBe(target);
  });
});

describe('mover un documento de carpeta (composición)', () => {
  const oldDir = '/home/u/docs';
  const newDir = '/home/u/otra';

  it('una imagen de dentro conserva su ruta relativa: no hace falta reescribir', () => {
    const abs = joinAndNormalize(oldDir, 'assets/logo.png');
    expect(isInsideDir(oldDir, abs)).toBe(true);
    const rel = relativeFrom(oldDir, abs)!;
    // Se copia a la misma ruta relativa bajo la carpeta nueva…
    expect(joinAndNormalize(newDir, rel)).toBe('/home/u/otra/assets/logo.png');
    // …y por eso el markdown no cambia.
    expect(rel).toBe('assets/logo.png');
  });

  it('una imagen de fuera se reapunta a donde ya está', () => {
    const src = '../instance/img.png';
    const abs = joinAndNormalize(oldDir, src);
    expect(isInsideDir(oldDir, abs)).toBe(false);
    const nuevo = relativeFrom(newDir, abs)!;
    expect(nuevo).toBe('../instance/img.png');
    // Y sigue resolviendo al mismo archivo desde la carpeta nueva.
    expect(joinAndNormalize(newDir, nuevo)).toBe(abs);
  });

  it('reapuntar desde una carpeta más profunda sube los niveles necesarios', () => {
    const abs = joinAndNormalize(oldDir, '../instance/img.png');
    const hondo = '/home/u/otra/sub/sub2';
    const nuevo = relativeFrom(hondo, abs)!;
    expect(joinAndNormalize(hondo, nuevo)).toBe('/home/u/instance/img.png');
  });
});
