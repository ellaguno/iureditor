# IureEditor 2.0 — Rust + egui

Plan de la suite: `iuredesk/docs/suite-integracion.md` §4.5 (tarea S1.15 de `iuredesk/docs/gaps.md`).

IureEditor 2.0 es una ventana egui sobre el editor de documentos de la suite Iurefficient
(`iure-doc` + `iure-doc-ui`, repositorio [`ellaguno/iure-doc`](https://github.com/ellaguno/iure-doc)): el mismo editor que ya usan las
notas de IureDesk y las notas de tareas de IureProject. La versión Tauri (`src-tauri/`, `src/`)
sigue siendo la que se publica hasta que la 2.0 tenga paridad en lo que la gente usa.

## Dónde está

`egui/` es un proyecto de Cargo propio (no toca el de Tauri). Depende por ruta de
`../iurefficient-ui` (como IureProject), de `iure-doc-ui` por etiqueta fija y del motor de
diagramas de IureDesk (`iuredesk-html-view`) por commit fijo. Compilar ese motor (stylo) pide
`python3` en desarrollo; el programa final es solo Rust.

```bash
cd egui && cargo run --release -- archivo.md
```

## Entregas

1. **Hecho (2.0.0-alpha.1)**: abrir (argumento o «Abrir…», Ctrl+O), nuevo (Ctrl+N), escribir con
   Markdown con formato al teclear y editor por bloques (~1 ms por tecla con 100 páginas), guardar
   (Ctrl+S, escritura atómica) y guardar como (Ctrl+Mayús+S); pregunta antes de perder cambios
   (nuevo, abrir, cerrar); si otro programa cambia el archivo se vuelve a leer (o se avisa si hay
   cambios sin guardar); tema del sistema, español e inglés. Diálogos de archivo en otro hilo.
2. **Hecho (alpha 2)**: el editor de la suite trae deshacer de todo el documento, selección entre
   bloques, tablas editables en su lugar y diagramas dibujados en su lugar: Mermaid y mapas
   mentales con el mismo motor que IureDesk (`iuredesk-html-view`, fijado a un commit), con los
   colores del tema; un clic muestra el código. También imágenes de la carpeta del documento en su lugar (las de internet no se descargan) pegar HTML como Markdown (de la web, Word o Google Docs) y corrector ortográfico (diccionarios Hunspell del sistema, español e inglés; diccionario personal en `~/.local/share/iureditor/diccionario.txt`). Pendiente: diccionarios incluidos para Windows y macOS (no traen Hunspell).
3. **Hecho**: recuperación de borradores como en la versión Tauri: con cambios sin guardar, 2,5 s
   después del último cambio se escribe un borrador (en otro hilo) en
   `~/.local/share/iureditor2/borradores/<pid>.json` (o `IUREDITOR_DATA_DIR`); al guardar o al
   cerrar con «No guardar» se borra; tras un cierre inesperado, al abrir se ofrece recuperarlo.
   Buscar y reemplazar en el documento (Ctrl+F / Ctrl+H). Resaltado de sintaxis del código. Pegar (Ctrl+V)
   o soltar imágenes: se guardan en `assets/` junto al documento, como la versión Tauri.
   Pestañas: cada documento con su propio editor (cursor, deshacer), borrador y vigilancia de
   cambios; Ctrl+T / Ctrl+N, Ctrl+W, Ctrl+Tab / Ctrl+Mayús+Tab, Ctrl+AvPág / Ctrl+RePág; abrir un
   documento ya abierto pasa a su pestaña; al cerrar la ventana se pregunta pestaña por pestaña y
   se guarda la sesión, que se restaura al abrir sin archivo; varios archivos en la línea de
   órdenes abren varias pestañas.
4. Exportar PDF (Typst), DOCX y HTML (S1.14).
5. Deep links y `--mcp` con los mismos esquemas que la versión Tauri (S1.8); migración de
   preferencias; documentos recientes, buscar y reemplazar, asistente.
6. Paridad medida contra la versión Tauri; entonces se retira Tauri.
