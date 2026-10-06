// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  fileUriToPath,
  imagePathFromText,
  imagePathFromUriList,
  isTransientImageSrc,
  fileFromTransientSrc,
  fileFromLocalPath,
  mimeForPath,
} from '../lib/pasteImages';

describe('rutas de imagen pegadas como texto', () => {
  it('URI file: con caracteres codificados', () => {
    expect(fileUriToPath('file:///home/u/Im%C3%A1genes/foto%201.png')).toBe('/home/u/Imágenes/foto 1.png');
    expect(fileUriToPath('file://localhost/tmp/x.png')).toBe('/tmp/x.png');
    expect(fileUriToPath('file:///C:/Users/x/a.jpg')).toBe('C:/Users/x/a.jpg');
    expect(fileUriToPath('https://x.com/a.png')).toBeNull();
  });

  it('texto plano: sólo una línea que sea URI o ruta absoluta de imagen', () => {
    expect(imagePathFromText('file:///home/u/foto.png\n')).toBe('/home/u/foto.png');
    expect(imagePathFromText('/home/u/foto.JPG')).toBe('/home/u/foto.JPG');
    expect(imagePathFromText('C:\\fotos\\a.png')).toBe('C:\\fotos\\a.png');
    expect(imagePathFromText('/home/u/doc.pdf')).toBeNull();
    expect(imagePathFromText('foto.png')).toBeNull();
    expect(imagePathFromText('file:///a.png\nfile:///b.png')).toBeNull();
    expect(imagePathFromText('texto normal')).toBeNull();
  });

  it('text/uri-list: ignora comentarios y toma la primera imagen', () => {
    expect(imagePathFromUriList('# nautilus\r\nfile:///x/doc.txt\r\nfile:///x/a.png\r\n')).toBe('/x/a.png');
    expect(imagePathFromUriList('https://x.com/a.png')).toBeNull();
  });

  it('src transitorio', () => {
    expect(isTransientImageSrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isTransientImageSrc('blob:tauri://localhost/uuid')).toBe(true);
    expect(isTransientImageSrc('file:///x.png')).toBe(true);
    expect(isTransientImageSrc('assets/x.png')).toBe(false);
    expect(isTransientImageSrc('https://x.com/a.png')).toBe(false);
    expect(isTransientImageSrc(null)).toBe(false);
  });

  it('mime por extensión', () => {
    expect(mimeForPath('/a/b.JPG')).toBe('image/jpeg');
    expect(mimeForPath('x.svg')).toBe('image/svg+xml');
  });
});

describe('File a partir de un src transitorio', () => {
  it('data: base64 → File con bytes y tipo', async () => {
    const file = await fileFromTransientSrc('data:image/jpeg;base64,/9j/4AAQ', async () => null);
    expect(file).not.toBeNull();
    expect(file!.type).toBe('image/jpeg');
    expect(file!.name).toMatch(/^pasted-\d+\.jpg$/);
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
  });

  it('file: lee del disco a través del lector inyectado', async () => {
    const reads: string[] = [];
    const file = await fileFromTransientSrc('file:///tmp/dibujo%20final.png', async (p) => {
      reads.push(p);
      return new Uint8Array([1, 2, 3]);
    });
    expect(reads).toEqual(['/tmp/dibujo final.png']);
    expect(file!.name).toBe('dibujo final.png');
    expect(file!.type).toBe('image/png');
    expect(file!.size).toBe(3);
  });

  it('ruta local inexistente → null', async () => {
    expect(await fileFromLocalPath('/no/existe.png', async () => null)).toBeNull();
  });
});
