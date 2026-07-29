import { describe, it, expect, beforeEach, vi } from 'vitest';

// `relocateImages` toca el disco, así que aquí el disco es un Map. Se prueba
// lo que de verdad decide: qué se copia, qué se reapunta y qué no se toca al
// mudar un documento de carpeta con «guardar como».

const disk = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  dirs: new Set<string>(),
  copies: [] as { from: string; to: string }[],
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: async (p: string) => disk.files.has(p) || disk.dirs.has(p),
  stat: async (p: string) => {
    const f = disk.files.get(p);
    if (!f) throw new Error(`ENOENT: ${p}`);
    return { size: f.length };
  },
  readFile: async (p: string) => {
    const f = disk.files.get(p);
    if (!f) throw new Error(`ENOENT: ${p}`);
    return f;
  },
  copyFile: async (from: string, to: string) => {
    const f = disk.files.get(from);
    if (!f) throw new Error(`ENOENT: ${from}`);
    disk.files.set(to, f);
    disk.copies.push({ from, to });
  },
  mkdir: async (p: string) => {
    disk.dirs.add(p);
  },
  writeTextFile: async () => {},
  writeFile: async () => {},
  readTextFile: async () => '',
}));

const { relocateImages } = await import('../lib/fileio');

const OLD = '/home/u/docs';
const NEW = '/home/u/otra';

const put = (path: string, content: string) =>
  disk.files.set(path, new TextEncoder().encode(content));

beforeEach(() => {
  disk.files.clear();
  disk.dirs.clear();
  disk.copies.length = 0;
});

describe('relocateImages: mudar un documento de carpeta', () => {
  it('copia la imagen que vive junto al documento y NO toca el markdown', async () => {
    put(`${OLD}/assets/logo.png`, 'PNG-logo');
    const md = 'Hola ![logo](assets/logo.png) adiós';

    const out = await relocateImages(md, OLD, NEW);

    expect(out.markdown).toBe(md); // la ruta relativa sigue siendo válida
    expect(out.copied).toBe(1);
    expect(out.relinked).toBe(0);
    expect(disk.files.has(`${NEW}/assets/logo.png`)).toBe(true);
    // Y el original se queda donde estaba: mover no es cortar.
    expect(disk.files.has(`${OLD}/assets/logo.png`)).toBe(true);
  });

  it('reapunta —sin duplicar— la imagen que vive fuera del documento', async () => {
    put('/home/u/instance/img.png', 'PNG-compartida');
    const md = '![x](../instance/img.png)';

    const out = await relocateImages(md, OLD, NEW);

    expect(out.markdown).toBe('![x](../instance/img.png)');
    expect(out.relinked).toBe(1);
    expect(out.copied).toBe(0);
    expect(disk.copies).toHaveLength(0); // una biblioteca compartida no se duplica
  });

  it('reapunta correctamente cuando la carpeta nueva está más honda', async () => {
    put('/home/u/instance/img.png', 'PNG');
    const out = await relocateImages('![x](../instance/img.png)', OLD, '/home/u/otra/sub');
    expect(out.markdown).toBe('![x](../../instance/img.png)');
  });

  it('no sobrescribe un archivo distinto que ya esté en destino', async () => {
    put(`${OLD}/assets/logo.png`, 'PNG-mio');
    put(`${NEW}/assets/logo.png`, 'PNG-de-otro');

    const out = await relocateImages('![l](assets/logo.png)', OLD, NEW);

    expect(new TextDecoder().decode(disk.files.get(`${NEW}/assets/logo.png`))).toBe(
      'PNG-de-otro'
    );
    expect(disk.files.has(`${NEW}/assets/logo-1.png`)).toBe(true);
    expect(out.markdown).toBe('![l](assets/logo-1.png)');
    expect(out.copied).toBe(1);
    expect(out.renamed).toBe(1);
  });

  it('sigue buscando nombre libre si -1 también está ocupado', async () => {
    put(`${OLD}/assets/logo.png`, 'PNG-mio');
    put(`${NEW}/assets/logo.png`, 'otro-1');
    put(`${NEW}/assets/logo-1.png`, 'otro-2');

    const out = await relocateImages('![l](assets/logo.png)', OLD, NEW);

    expect(out.markdown).toBe('![l](assets/logo-2.png)');
    expect(new TextDecoder().decode(disk.files.get(`${NEW}/assets/logo-2.png`))).toBe(
      'PNG-mio'
    );
  });

  it('si en destino ya está la MISMA imagen, no copia ni reescribe', async () => {
    put(`${OLD}/assets/logo.png`, 'PNG-igual');
    put(`${NEW}/assets/logo.png`, 'PNG-igual');

    const out = await relocateImages('![l](assets/logo.png)', OLD, NEW);

    expect(out.copied).toBe(0);
    expect(disk.copies).toHaveLength(0);
    expect(out.markdown).toBe('![l](assets/logo.png)');
  });

  it('una referencia ya rota se deja como estaba', async () => {
    const md = '![no existe](assets/fantasma.png)';
    const out = await relocateImages(md, OLD, NEW);
    expect(out.markdown).toBe(md);
    expect(out.broken).toEqual(['assets/fantasma.png']);
    expect(disk.copies).toHaveLength(0);
  });

  it('no toca imágenes remotas, data: ni absolutas', async () => {
    const md = [
      '![a](https://example.com/a.png)',
      '![b](data:image/png;base64,AAA)',
      '![c](/home/u/abs.png)',
    ].join('\n\n');
    const out = await relocateImages(md, OLD, NEW);
    expect(out.markdown).toBe(md);
    expect(disk.copies).toHaveLength(0);
  });

  it('guardar como en la MISMA carpeta no hace nada', async () => {
    put(`${OLD}/assets/logo.png`, 'PNG');
    const md = '![l](assets/logo.png)';
    const out = await relocateImages(md, OLD, OLD);
    expect(out).toEqual({ markdown: md, copied: 0, renamed: 0, relinked: 0, broken: [] });
    expect(disk.copies).toHaveLength(0);
  });

  it('maneja varias imágenes a la vez, cada una por su vía', async () => {
    put(`${OLD}/assets/a.png`, 'A');
    put(`${OLD}/sub/b.png`, 'B');
    put('/home/u/instance/c.png', 'C');
    const md = [
      '![a](assets/a.png)',
      '<img src="sub/b.png" alt="b">',
      '![c](../instance/c.png)',
      '![roto](assets/z.png)',
    ].join('\n\n');

    const out = await relocateImages(md, OLD, NEW);

    expect(out.copied).toBe(2);
    expect(out.relinked).toBe(1);
    expect(out.broken).toEqual(['assets/z.png']);
    expect(disk.files.has(`${NEW}/assets/a.png`)).toBe(true);
    expect(disk.files.has(`${NEW}/sub/b.png`)).toBe(true);
    expect(out.markdown).toContain('![a](assets/a.png)');
    expect(out.markdown).toContain('<img src="sub/b.png" alt="b">');
    expect(out.markdown).toContain('![c](../instance/c.png)');
    expect(out.markdown).toContain('![roto](assets/z.png)');
  });

  it('la misma imagen referida dos veces se copia una sola vez', async () => {
    put(`${OLD}/assets/a.png`, 'A');
    const out = await relocateImages('![1](assets/a.png) ![2](assets/a.png)', OLD, NEW);
    expect(out.copied).toBe(1);
    expect(disk.copies).toHaveLength(1);
  });

  it('resuelve nombres con espacios percent-codificados', async () => {
    put(`${OLD}/assets/mi foto.png`, 'F');
    const out = await relocateImages('![f](assets/mi%20foto.png)', OLD, NEW);
    expect(out.copied).toBe(1);
    expect(disk.files.has(`${NEW}/assets/mi foto.png`)).toBe(true);
    expect(out.markdown).toBe('![f](assets/mi%20foto.png)');
  });
});
