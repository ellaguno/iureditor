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
4. Exportar (S1.14). **Hecho**: «Exportar» → página web (HTML autocontenido: estilos, imágenes y
   diagramas dentro), Word (DOCX con estilos de título de Word, listas numeradas, tablas,
   imágenes y diagramas dibujados con el mismo motor) y PDF (Typst compilado dentro, con sus
   letras: igual en cualquier sistema, sin diálogo de impresión), con `iure-doc-export`; en otro
   hilo, con escritura atómica. Sin ventana: `iureditor2 --export nota.md nota.pdf` (o `.docx`,
   `.html`).
5. **Hecho (`--mcp`, S1.8)**: `iureditor2 --mcp` (MCP por stdio, protocolo de
   `iurefficient-connect`): `exportar_documento` y `convertir_markdown` (PDF, Word, HTML),
   `html_a_markdown`, `listar_plantillas` y `crear_desde_plantilla` (las plantillas de la versión
   Tauri, en su misma carpeta; `{{fecha}}`, `{{date}}` y campos propios; nunca reemplaza un
   archivo). **Hecho (enlaces)**: `iureditor://open`, `insert` y `edit` (los de la versión Tauri:
   IureVoz dicta en el cursor sin quitarle el foco a nadie, con deshacer) y una sola ventana: un
   segundo `iureditor2` le pasa sus argumentos a la abierta por un socket local con token (TCP
   local en Windows) y termina. **Pendiente**: `iureditor://iurefficient/doc` (documentos de la
   instancia), registrar el esquema al instalar (archivo `.desktop`, registro de Windows,
   `Info.plist`); migración de
   preferencias; documentos recientes, buscar y reemplazar, asistente.
6. Paridad medida contra la versión Tauri; entonces se retira Tauri.

**Decisión del dueño (2026-11-19):** no se publica ninguna versión de la 2.0 —ni alfa— hasta que
esté **al menos como la 1.19.2 visualmente** (la alfa 3 quedó como borrador sin publicar: «le falta
visualmente todo»). Falta, contra la 1.19.2: pestañas en la barra de título y menú ☰, barra de
formato, panel lateral (Archivos, Buscar, Esquema, Iurefficient), barra de estado (línea, palabras,
caracteres, zoom), WYSIWYG de verdad en el editor (casillas, viñetas, citas y código dibujados sin
las marcas, columna centrada y tipografía de documento), fórmulas, avisos, color y resaltado.
Orden propuesto: 1) WYSIWYG en `iure-doc` (mejora también IureDesk e IureProject), 2) marco de la
ventana, 3) panel lateral, 4) lo demás.

**Avance:** 1) **Hecho** (iure-doc v0.15.0): viñetas, casillas que se marcan con un clic, barra de las
citas, regla, código en una caja con su lenguaje y cercas plegadas, columna de documento centrada.
2) **Hecho**: barra de título propia (ventana sin la del sistema; `IUREDITOR_SYSTEM_TITLEBAR=1`
la devuelve) con el menú ☰ (Archivo, Edición, Ayuda, con sus atajos), las pestañas y los botones
de la ventana con el estilo y el orden del escritorio (`iurefficient_ui::window`, compartido con
IureDesk); barra de formato (deshacer y rehacer, títulos 1–3, negrita, cursiva, tachado, código,
listas con viñetas, numeradas y de tareas, cita, bloque de código, regla, enlace, tabla, diagrama;
sobre la selección con `iure-doc` v0.16.0); barra de estado (línea, palabras, caracteres, guardado).
3) **Hecho**: panel lateral (botón en la barra de título; abierto en el esquema): **Esquema**
(títulos del documento con el actual resaltado; un clic lleva el cursor, `iure-doc` v0.17.0
`focus_offset`), **Archivos** (los Markdown de la carpeta del documento o de «Abrir carpeta…»,
acotado), **Buscar** (Ctrl+Mayús+F; texto en esos archivos en otro hilo; un clic abre el archivo
en ese lugar).
4) **Hecho**: tipografía de documento (`iure-doc` v0.18.0: títulos mayores, interlineado 1,5, aire
antes de los títulos; letra del documento ≈16 px, un 15 % sobre la de la interfaz); zoom del
documento (Ctrl + / Ctrl − / Ctrl 0, Ctrl con la rueda, «− 100 % +» en la barra de estado,
recordado en `preferencias.json`; la interfaz no cambia); menú ☰ › **Ver** (panel lateral, esquema,
buscar en los archivos, acercar/alejar/tamaño real).
5) **Hecho**: pestaña **Iurefficient** (`egui/src/iure.rs`, como la 1.x): conectar (dominio, correo,
contraseña y código TOTP) o retomar la sesión compartida de la suite (llavero `iurefficient`,
`cuenta-activa.json`); buscar proyectos, abrir sus documentos de texto como espejos locales
(`<datos>/iurefficient/<caso>/<doc>/`), «Subir versión ahora», «Subir versión al guardar (Ctrl+S)» y
«Guardar en Iurefficient…» (General o el proyecto elegido). Panel de **Archivos** con las acciones
de la 1.x: buscar (la lupa; ya no es pestaña), nuevo archivo, nueva carpeta, subir un directorio,
recargar, cambiar carpeta; clic derecho: renombrar, nuevo, recargar. Atajos Ctrl+Mayús+E / O / I.
6) **Hecho** (`iure-doc` v0.19.0): menú **`/`** (títulos, listas, cita, código, tabla, diagrama,
fórmula, separador, avisos, mapa mental; se filtra al escribir: `/mental`, `/diagrama`), **`[[`**
con las notas de la carpeta (por nombre o ruta; «Crear nota «…»»; `[[nota#` sugiere sus títulos) y
Ctrl+clic para abrir el enlace (crea la nota si no existe; `#título` lleva al título; las direcciones
web van al navegador), selector **Plantilla…** con las 21 plantillas Mermaid de la 1.x en los
bloques de diagrama, **barra de buscar/reemplazar** en franja como la 1.x (contador `1/5`, flechas,
Aa, «Reemplazar…», cerrar). Pegar ya no toma un HTML viejo del portapapeles (GNOME).
**Siguiente:** apps de la suite en la pestaña Iurefficient, panel de enlaces (retroenlaces),
asistente, fórmulas, avisos con estilo, color y resaltado.

**Alfas** (cuando se cumpla lo anterior; convive con la 1.x): etiqueta `egui-vX.Y.Z-alpha.N` → `release-egui.yml`
compila Linux (`.tar.gz` con `instalar.sh`), Windows (`.zip`) y macOS universal (`.app` en
`.zip`) con `egui/scripts/package.sh` y deja una Release **borrador y preliminar** (no «Latest»:
el actualizador de la 1.x no la ve). Notas en `egui/notas/<etiqueta>.md`.
