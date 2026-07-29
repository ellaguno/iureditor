import { describe, it, expect } from 'vitest';
import { inDir, dirname, basename } from '../lib/fileio';

// `inDir` compone el `defaultPath` de todos los diálogos de archivo: si se
// rompe, cada diálogo vuelve a abrirse en una carpeta distinta.

describe('inDir: directorio por defecto de los diálogos', () => {
  it('ancla el nombre sugerido en el directorio dado', () => {
    expect(inDir('/home/u/docs', 'documento.md')).toBe('/home/u/docs/documento.md');
  });

  it('deja el nombre suelto si no hay directorio', () => {
    expect(inDir(null, 'documento.md')).toBe('documento.md');
    expect(inDir(undefined, 'documento.md')).toBe('documento.md');
    expect(inDir('', 'documento.md')).toBe('documento.md');
  });

  it('no duplica la barra final del directorio', () => {
    expect(inDir('/home/u/docs/', 'a.md')).toBe('/home/u/docs/a.md');
  });

  it('reabre en la carpeta nueva tras un «guardar como» (dirname∘inDir)', () => {
    const guardadoEn = inDir('/home/u/otra', basename('/home/u/docs/nota.md'));
    expect(guardadoEn).toBe('/home/u/otra/nota.md');
    // El siguiente diálogo parte de la carpeta nueva, no de la original.
    expect(dirname(guardadoEn)).toBe('/home/u/otra');
  });
});
