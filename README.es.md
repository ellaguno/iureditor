[Read in English](README.md)

# iureditor

Editor WYSIWYG de Markdown de escritorio, con diagramas Mermaid en vivo y exportación a PDF y DOCX.

Construido con [Tauri v2](https://tauri.app), React y [TipTap](https://tiptap.dev). Multiplataforma: Linux, Windows y macOS.

## Características

- **Editor WYSIWYG**: edita markdown como texto enriquecido (encabezados, listas —incluidas anidadas—, tablas, tareas, código con resaltado de sintaxis, imágenes, enlaces).
- **Pestañas**: varios documentos abiertos a la vez, cada uno con su propio historial de deshacer. `Ctrl+W` cierra la pestaña y `Ctrl+Tab` cambia entre ellas.
- **Round-trip fiel markdown ↔ HTML**: los archivos `.md` se conservan estables al abrir y guardar.
- **Fórmulas LaTeX**: `$inline$` y `$$bloque$$` renderizadas con KaTeX dentro del editor; clic sobre la fórmula para editarla.
- **Notas al pie**: sintaxis `[^1]` de markdown, con botón de inserción y numeración automática. En DOCX se exportan como notas al pie reales de Word.
- **Índice**: inserta una tabla de contenido con enlaces a los encabezados (Edición → Insertar índice); los exports HTML/PDF llevan las anclas correspondientes.
- **Front matter YAML**: los metadatos `---` al inicio del archivo se preservan (visibles en la vista de código fuente, excluidos de los exports).
- **Mermaid en vivo**: los bloques ` ```mermaid ` se renderizan como diagrama dentro del editor; clic para editar el código. Exporta cada diagrama a SVG o PNG.
- **Exportación**: PDF (texto seleccionable, diagramas vectoriales, fórmulas como MathML), DOCX (compatible con Word y LibreOffice) y HTML autosuficiente.
- **Imágenes locales**: pega o arrastra imágenes y se guardan junto al documento en `assets/` con referencias relativas.
- **Recuperación de borradores**: si la app se cierra mal, al reabrir ofrece recuperar lo no guardado de todas las pestañas.
- **Vista de código fuente, esquema del documento, búsqueda y reemplazo, corrector ortográfico, tema claro/oscuro y zoom.**
- **Interfaz en inglés y español**: la app arranca en inglés, o en español si el sistema operativo está en español; se puede fijar el idioma en Ver → Language / Idioma.

## Desarrollo

Requisitos: Node.js ≥ 20, Rust (stable) y las dependencias de Tauri para tu plataforma
(en Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev` — ver
[prerrequisitos de Tauri](https://tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri dev     # app de escritorio en modo desarrollo
npm test              # tests (round-trip markdown)
npm run tauri build   # binarios (AppImage/.deb en Linux)
```

### Solución de problemas en Linux

Si la ventana aparece en blanco o parpadea (NVIDIA/Wayland), prueba:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 iureditor
```

## Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

*Firma de código gratuita proporcionada por SignPath.io, con certificado de SignPath
Foundation. Es lo que hace que Windows muestre un editor conocido en lugar de la
advertencia de SmartScreen.*

- **Committers and reviewers:** Eduardo Llaguno ([@ellaguno](https://github.com/ellaguno)).
- **Approvers:** Eduardo Llaguno ([@ellaguno](https://github.com/ellaguno)).
- Every Windows release is built from this repository by GitHub Actions
  (`.github/workflows/release.yml`), submitted to SignPath from that workflow and
  approved manually before it is signed. Only the installer published on the
  [releases page](https://github.com/ellaguno/iureditor/releases) is signed.

### Privacy policy

This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.

Specifically, IureEditor connects only to:

- the Iurefficient instance that the user configures, and only when the user
  signs in or opens, saves or lists documents there;
- `api.github.com`, once a few seconds after start-up, to check whether a newer
  release exists. Nothing is downloaded or installed without asking first.

It collects no telemetry and no usage statistics. Documents are edited locally.
Credentials are stored in the operating system keychain, never in configuration
files.

## Licencia

[MIT](LICENSE)
