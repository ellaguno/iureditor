import {
  readDir,
  readTextFile,
  writeTextFile,
  mkdir,
  exists,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

// Plantillas de documento: archivos .md en <appData>/plantillas. El usuario
// puede añadir las suyas desde "Abrir carpeta de plantillas". Al crear un
// documento desde plantilla, {{fecha}} se sustituye por la fecha del día.

const DIR = 'plantillas';

export const templatesDirPath = (): Promise<string> =>
  appDataDir().then((dir) => join(dir, DIR));

const STARTERS: Record<string, string> = {
  'Escrito legal.md': `---
titulo: Escrito
expediente: 000/0000
autor:
fecha: {{fecha}}
---

# Escrito

**C. JUEZ** — [órgano jurisdiccional]

[Nombre], por mi propio derecho, señalando como domicilio para oír y recibir notificaciones el ubicado en [domicilio], ante usted comparezco y expongo:

## Hechos

1. Primer hecho.
2. Segundo hecho.

## Derecho

Son aplicables los artículos [—].

## Puntos petitorios

**PRIMERO.** Tenerme por presentado en los términos de este escrito.

**SEGUNDO.** Acordar de conformidad lo solicitado.

Protesto lo necesario.

[Lugar], a {{fecha}}.
`,
  'Contrato.md': `---
titulo: Contrato
expediente:
fecha: {{fecha}}
---

# Contrato de [objeto]

Contrato que celebran por una parte **[Parte A]** y por la otra **[Parte B]**, al tenor de las siguientes declaraciones y cláusulas.

## Declaraciones

1. Declara **[Parte A]**…
2. Declara **[Parte B]**…

## Cláusulas

**PRIMERA. Objeto.**

**SEGUNDA. Contraprestación.**

| Concepto | Monto | Plazo |
|----------|-------|-------|
|          |       |       |

**TERCERA. Vigencia.**

Leído el presente y enteradas las partes de su contenido y alcance, lo firman por duplicado en [lugar], a {{fecha}}.
`,
  'Acta de reunión.md': `---
titulo: Acta de reunión
fecha: {{fecha}}
---

# Acta de reunión — {{fecha}}

**Asistentes:**

-

## Temas tratados

1.

## Acuerdos

- [ ] Acuerdo 1 — responsable, fecha compromiso

## Próxima reunión

Fecha: — Lugar: —
`,
};

/** Crea la carpeta y las plantillas de arranque la primera vez. */
export const ensureStarterTemplates = async (): Promise<void> => {
  try {
    if (await exists(DIR, { baseDir: BaseDirectory.AppData })) return;
    await mkdir(DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    for (const [name, content] of Object.entries(STARTERS)) {
      await writeTextFile(`${DIR}/${name}`, content, { baseDir: BaseDirectory.AppData });
    }
  } catch (err) {
    console.error('No se pudieron crear las plantillas de arranque:', err);
  }
};

/** Nombres de plantilla disponibles (sin extensión), orden alfabético. */
export const listTemplates = async (): Promise<string[]> => {
  try {
    const entries = await readDir(DIR, { baseDir: BaseDirectory.AppData });
    return entries
      .filter((e) => e.isFile && /\.md$/i.test(e.name))
      .map((e) => e.name.replace(/\.md$/i, ''))
      .sort((a, b) => a.localeCompare(b, 'es'));
  } catch {
    return [];
  }
};

/** Contenido de la plantilla con {{fecha}} resuelta al día de hoy. */
export const readTemplate = async (name: string): Promise<string> => {
  const raw = await readTextFile(`${DIR}/${name}.md`, { baseDir: BaseDirectory.AppData });
  const today = new Date().toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return raw.replaceAll('{{fecha}}', today);
};

export const openTemplatesFolder = async (): Promise<void> => {
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(await templatesDirPath());
};
