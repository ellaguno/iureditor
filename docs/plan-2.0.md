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
   colores del tema; un clic muestra el código. También imágenes de la carpeta del documento en su lugar (las de internet no se descargan) y pegar HTML como Markdown (de la web, Word o Google Docs).
3. Exportar PDF (Typst), DOCX y HTML (S1.14).
4. Deep links y `--mcp` con los mismos esquemas que la versión Tauri (S1.8); migración de
   preferencias; documentos recientes, buscar y reemplazar, asistente.
5. Paridad medida contra la versión Tauri; entonces se retira Tauri.
