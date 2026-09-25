// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { DICTIONARIES, t, tn, setLang, getLang, locale } from '../lib/i18n';

// Los tipos ya obligan a que `es` tenga las claves de `en`; esto cubre además
// las claves sobrantes y que los marcadores {x} coincidan en ambos idiomas.

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  afterEach(() => setLang('en'));

  it('en y es tienen exactamente las mismas claves', () => {
    expect(Object.keys(DICTIONARIES.es).sort()).toEqual(Object.keys(DICTIONARIES.en).sort());
  });

  it('los marcadores de interpolación coinciden y no hay textos vacíos', () => {
    for (const key of Object.keys(DICTIONARIES.en) as (keyof typeof DICTIONARIES.en)[]) {
      // Los ejemplos de mermaid llevan llaves de la sintaxis, no marcadores.
      if (key.startsWith('mermaid.code.')) continue;
      expect(placeholders(DICTIONARIES.es[key]), key).toEqual(placeholders(DICTIONARIES.en[key]));
      expect(DICTIONARIES.en[key].trim(), key).not.toBe('');
      expect(DICTIONARIES.es[key].trim(), key).not.toBe('');
    }
  });

  it('inglés por defecto; cambia de idioma e interpola', () => {
    expect(getLang()).toBe('en');
    expect(t('menu.version', { version: '1.2.3' })).toBe('Version 1.2.3');
    setLang('es');
    expect(t('menu.version', { version: '1.2.3' })).toBe('Versión 1.2.3');
    expect(locale()).toBe('es-MX');
    expect(document.documentElement.lang).toBe('es');
  });

  it('plural simple', () => {
    expect(tn(1, 'print.pagesOne', 'print.pagesOther')).toMatch(/^1 page /);
    expect(tn(3, 'print.pagesOne', 'print.pagesOther')).toMatch(/^3 pages /);
  });
});
