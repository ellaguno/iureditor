import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { extractMermaid } from '../lib/mermaidAssist';

describe('extractMermaid', () => {
  it('toma el bloque ```mermaid aunque haya texto alrededor', () => {
    const reply = 'Claro, aquí está:\n\n```mermaid\nflowchart TD\n    A --> B\n```\n\nEspero que sirva.';
    expect(extractMermaid(reply)).toBe('flowchart TD\n    A --> B');
  });

  it('acepta una cerca sin lenguaje', () => {
    expect(extractMermaid('```\npie title X\n    "A" : 1\n```')).toBe('pie title X\n    "A" : 1');
  });

  it('usa la respuesta entera si no hay cerca', () => {
    expect(extractMermaid('\nsequenceDiagram\n    A->>B: Hola\n')).toBe('sequenceDiagram\n    A->>B: Hola');
  });

  it('sólo el primer bloque', () => {
    const reply = '```mermaid\ngraph LR\n  A-->B\n```\n```mermaid\ngraph LR\n  C-->D\n```';
    expect(extractMermaid(reply)).toBe('graph LR\n  A-->B');
  });
});
