# iureditor

Editor WYSIWYG de Markdown de escritorio, con diagramas Mermaid en vivo y exportación a PDF y DOCX.

Construido con [Tauri v2](https://tauri.app), React y [TipTap](https://tiptap.dev). Multiplataforma: Linux, Windows y macOS.

## Características

- **Editor WYSIWYG**: edita markdown como texto enriquecido (encabezados, listas, tablas, tareas, código con resaltado de sintaxis, imágenes, enlaces).
- **Round-trip fiel markdown ↔ HTML**: los archivos `.md` se conservan estables al abrir y guardar.
- **Mermaid en vivo**: los bloques ` ```mermaid ` se renderizan como diagrama dentro del editor; clic para editar el código. Exporta cada diagrama a SVG o PNG.
- **Exportación**: PDF (texto seleccionable, diagramas vectoriales) y DOCX (compatible con Word y LibreOffice).
- **Imágenes locales**: pega o arrastra imágenes y se guardan junto al documento en `assets/` con referencias relativas.

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

## Licencia

[MIT](LICENSE)
