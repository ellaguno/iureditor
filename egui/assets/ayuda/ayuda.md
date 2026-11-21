![iureditor](img/iureditor.png)

# Ayuda de iureditor

**iureditor** es un editor de Markdown WYSIWYG: escribes con formato visual y el
documento se guarda como Markdown limpio y portable. Incluye diagramas Mermaid
en vivo, imágenes, tablas, notas al pie, fórmulas y exportación a PDF, DOCX y HTML.

> [!TIP]
> Este documento es en sí mismo un ejemplo de lo que puedes crear. Abre el panel
> **Esquema del documento** (Ctrl+Shift+O) para navegarlo como un índice vivo.

## Índice

1. La interfaz de un vistazo
2. La barra de herramientas
3. El menú (☰)
4. Pestañas y ventanas
5. Panel lateral
6. Enlaces entre notas
7. Vista de código fuente
8. Insertar contenido
9. El menú rápido «/»
10. Buscar y reemplazar
11. Exportar
12. Plantillas
13. Apariencia y lectura
14. Atajos de teclado
15. Actualizaciones

---

## 1. La interfaz de un vistazo

![Mapa de la interfaz de iureditor](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMzYwIiB2aWV3Qm94PSIwIDAgNjQwIDM2MCIgZm9udC1mYW1pbHk9InN5c3RlbS11aSxTZWdvZSBVSSxSb2JvdG8sc2Fucy1zZXJpZiI+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIzNTgiIHJ4PSIxMCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjY2JkNWUxIi8+CiAgPCEtLSBUaXRsZSBiYXIgLS0+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSI0NiIgcng9IjEwIiBmaWxsPSIjZjFmNWY5Ii8+CiAgPHJlY3QgeD0iMSIgeT0iMzYiIHdpZHRoPSI2MzgiIGhlaWdodD0iMTEiIGZpbGw9IiNmMWY1ZjkiLz4KICA8cmVjdCB4PSIxNiIgeT0iMTQiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgcng9IjUiIGZpbGw9IiNlMmU4ZjAiIHN0cm9rZT0iIzk0YTNiOCIvPgogIDxyZWN0IHg9IjQ0IiB5PSIxNCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiByeD0iNSIgZmlsbD0iI2RiZWFmZSIgc3Ryb2tlPSIjNjBhNWZhIi8+CiAgPHJlY3QgeD0iODAiIHk9IjE1IiB3aWR0aD0iOTYiIGhlaWdodD0iMTgiIHJ4PSI2IiBmaWxsPSIjZmZmZmZmIiBzdHJva2U9IiNjYmQ1ZTEiLz4KICA8cmVjdCB4PSIxODQiIHk9IjE1IiB3aWR0aD0iOTYiIGhlaWdodD0iMTgiIHJ4PSI2IiBmaWxsPSIjZTJlOGYwIi8+CiAgPGNpcmNsZSBjeD0iNTg2IiBjeT0iMjQiIHI9IjgiIGZpbGw9IiNlMmU4ZjAiLz4KICA8Y2lyY2xlIGN4PSI2MDgiIGN5PSIyNCIgcj0iOCIgZmlsbD0iI2UyZThmMCIvPgogIDxjaXJjbGUgY3g9IjYyNiIgY3k9IjI0IiByPSI4IiBmaWxsPSIjZmVjYWNhIi8+CiAgPHRleHQgeD0iNzAiIHk9IjI4IiBmb250LXNpemU9IjExIiBmaWxsPSIjMzM0MTU1IiB0ZXh0LWFuY2hvcj0iZW5kIj7imLA8L3RleHQ+CiAgPHRleHQgeD0iMTI4IiB5PSIyNyIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzMzNDE1NSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+ZG9jdW1lbnRvLm1kPC90ZXh0PgogIDwhLS0gVG9vbGJhciAtLT4KICA8cmVjdCB4PSIxIiB5PSI0NyIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIzNCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjZTJlOGYwIi8+CiAgPGcgZmlsbD0iIzQ3NTU2OSI+CiAgICA8cmVjdCB4PSIxNCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz48cmVjdCB4PSIzNCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz4KICAgIDxyZWN0IHg9IjYyIiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPjxyZWN0IHg9IjgyIiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPjxyZWN0IHg9IjEwMiIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz4KICAgIDxyZWN0IHg9IjEzMCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz48cmVjdCB4PSIxNTAiIHk9IjU3IiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiIHJ4PSIzIi8+CiAgICA8cmVjdCB4PSIxNzgiIHk9IjU3IiB3aWR0aD0iMTYiIGhlaWdodD0iMTQiIHJ4PSIzIi8+PHJlY3QgeD0iMTk4IiB5PSI1NyIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE0IiByeD0iMyIvPjxyZWN0IHg9IjIxOCIgeT0iNTciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNCIgcng9IjMiLz4KICA8L2c+CiAgPHRleHQgeD0iMzMwIiB5PSI2OCIgZm9udC1zaXplPSIxMSIgZmlsbD0iIzk0YTNiOCI+YmFycmEgZGUgaGVycmFtaWVudGFzIGRlIGZvcm1hdG/igKY8L3RleHQ+CiAgPCEtLSBTaWRlYmFyIC0tPgogIDxyZWN0IHg9IjEiIHk9IjgxIiB3aWR0aD0iMTUwIiBoZWlnaHQ9IjI0OCIgZmlsbD0iI2Y4ZmFmYyIgc3Ryb2tlPSIjZTJlOGYwIi8+CiAgPHRleHQgeD0iMTYiIHk9IjEwMiIgZm9udC1zaXplPSIxMSIgZmlsbD0iIzY0NzQ4YiIgZm9udC13ZWlnaHQ9IjYwMCI+QVJDSElWT1MgLyBFU1FVRU1BPC90ZXh0PgogIDxnIGZpbGw9IiNjYmQ1ZTEiPjxyZWN0IHg9IjE2IiB5PSIxMTYiIHdpZHRoPSIxMTgiIGhlaWdodD0iOCIgcng9IjQiLz48cmVjdCB4PSIxNiIgeT0iMTM0IiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMjgiIHk9IjE1MiIgd2lkdGg9IjkwIiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMjgiIHk9IjE3MCIgd2lkdGg9Ijk0IiBoZWlnaHQ9IjgiIHJ4PSI0Ii8+PHJlY3QgeD0iMTYiIHk9IjE4OCIgd2lkdGg9IjExMCIgaGVpZ2h0PSI4IiByeD0iNCIvPjwvZz4KICA8IS0tIEVkaXRvciAtLT4KICA8cmVjdCB4PSIxNTEiIHk9IjgxIiB3aWR0aD0iNDg4IiBoZWlnaHQ9IjI0OCIgZmlsbD0iI2ZmZmZmZiIvPgogIDxyZWN0IHg9IjIxMCIgeT0iMTA0IiB3aWR0aD0iMzcwIiBoZWlnaHQ9IjE2IiByeD0iNCIgZmlsbD0iI2UyZThmMCIvPgogIDxnIGZpbGw9IiNlZWYyZjciPjxyZWN0IHg9IjIxMCIgeT0iMTM2IiB3aWR0aD0iMzYwIiBoZWlnaHQ9IjkiIHJ4PSI0Ii8+PHJlY3QgeD0iMjEwIiB5PSIxNTQiIHdpZHRoPSIzNzIiIGhlaWdodD0iOSIgcng9IjQiLz48cmVjdCB4PSIyMTAiIHk9IjE3MiIgd2lkdGg9IjMzMCIgaGVpZ2h0PSI5IiByeD0iNCIvPjwvZz4KICA8cmVjdCB4PSIyMTAiIHk9IjIwMCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSIxNCIgcng9IjQiIGZpbGw9IiNkYmVhZmUiLz4KICA8ZyBmaWxsPSIjZWVmMmY3Ij48cmVjdCB4PSIyMTAiIHk9IjIyOCIgd2lkdGg9IjM2MCIgaGVpZ2h0PSI5IiByeD0iNCIvPjxyZWN0IHg9IjIxMCIgeT0iMjQ2IiB3aWR0aD0iMzAwIiBoZWlnaHQ9IjkiIHJ4PSI0Ii8+PC9nPgogIDwhLS0gU3RhdHVzIGJhciAtLT4KICA8cmVjdCB4PSIxIiB5PSIzMjkiIHdpZHRoPSI2MzgiIGhlaWdodD0iMzAiIHJ4PSIxMCIgZmlsbD0iI2YxZjVmOSIvPgogIDxyZWN0IHg9IjEiIHk9IjMyOSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIxMSIgZmlsbD0iI2YxZjVmOSIvPgogIDx0ZXh0IHg9IjE2IiB5PSIzNDkiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM2NDc0OGIiPjEuMjM0IHBhbGFicmFzIMK3IDcuODkwIGNhcmFjdGVyZXM8L3RleHQ+CiAgPHRleHQgeD0iNjI0IiB5PSIzNDkiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiM2NDc0OGIiIHRleHQtYW5jaG9yPSJlbmQiPk1hcmtkb3duIMK3IFVURi04PC90ZXh0PgogIDwhLS0gbGFiZWxzIC0tPgogIDx0ZXh0IHg9IjMwMCIgeT0iMzQiIGZvbnQtc2l6ZT0iMTAiIGZpbGw9IiMxZDRlZDgiIGZvbnQtd2VpZ2h0PSI2MDAiPnBlc3Rhw7FhczwvdGV4dD4KPC9zdmc+Cg==)

De arriba a abajo:

- **Barra de título**: el botón ☰ abre el menú principal, a su lado van las
  **pestañas** de los documentos abiertos y, a la derecha, los botones de ventana.
- **Barra de herramientas**: botones de formato del documento activo.
- **Panel lateral** (izquierda): pestañas **Archivos** (con la búsqueda en
  archivos), **Esquema** del documento, **Enlaces** de la nota, **Iurefficient** y el
  **Asistente** (icono de destellos). Se oculta con el botón de la esquina.
- **Área de edición**: el documento, tal como se verá.
- **Barra de estado** (abajo): conteo de palabras y caracteres, y formato del archivo.

## 2. La barra de herramientas

![Grupos de la barra de herramientas](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NDAiIGhlaWdodD0iMTUwIiB2aWV3Qm94PSIwIDAgNjQwIDE1MCIgZm9udC1mYW1pbHk9InN5c3RlbS11aSxTZWdvZSBVSSxSb2JvdG8sc2Fucy1zZXJpZiI+CiAgPHJlY3QgeD0iMSIgeT0iMSIgd2lkdGg9IjYzOCIgaGVpZ2h0PSIxNDgiIHJ4PSIxMCIgZmlsbD0iI2ZmZmZmZiIgc3Ryb2tlPSIjY2JkNWUxIi8+CiAgPGcgZm9udC1zaXplPSIxMSIgZmlsbD0iIzFlMjkzYiIgZm9udC13ZWlnaHQ9IjYwMCI+CiAgICA8dGV4dCB4PSIyMCIgeT0iMjgiPkRlc2hhY2VyIC8gcmVoYWNlcjwvdGV4dD4KICAgIDx0ZXh0IHg9IjIwIiB5PSI1MiI+VMOtdHVsb3MgSDHigJNIMzwvdGV4dD4KICAgIDx0ZXh0IHg9IjIwIiB5PSI3NiI+Rm9ybWF0bzogbmVncml0YSwgY3Vyc2l2YSwgc3VicmF5YWRvLCBjw7NkaWdvLCBzdWIvc3VwZXLDrW5kaWNlPC90ZXh0PgogICAgPHRleHQgeD0iMjAiIHk9IjEwMCI+Q29sb3IgeSByZXNhbHRhZG8gwrcgQWxpbmVhY2nDs24gwrcgTGlzdGFzPC90ZXh0PgogICAgPHRleHQgeD0iMjAiIHk9IjEyNCI+QmxvcXVlczogY2l0YSwgY8OzZGlnbywgbMOtbmVhLCBNZXJtYWlkLCBub3RhIGFsIHBpZSwgZsOzcm11bGEsIGVubGFjZSwgaW1hZ2VuLCB0YWJsYTwvdGV4dD4KICA8L2c+CiAgPGcgZmlsbD0iIzNiODJmNiI+PGNpcmNsZSBjeD0iMTAiIGN5PSIyNCIgcj0iMyIvPjxjaXJjbGUgY3g9IjEwIiBjeT0iNDgiIHI9IjMiLz48Y2lyY2xlIGN4PSIxMCIgY3k9IjcyIiByPSIzIi8+PGNpcmNsZSBjeD0iMTAiIGN5PSI5NiIgcj0iMyIvPjxjaXJjbGUgY3g9IjEwIiBjeT0iMTIwIiByPSIzIi8+PC9nPgo8L3N2Zz4K)

Los botones están agrupados por función. Pasa el ratón por encima de cualquiera
para ver su nombre y su atajo.

## 3. El menú (☰)

El menú principal se organiza en **secciones colapsables**. Pulsa el título de una
sección para desplegarla o plegarla; puedes tener varias abiertas a la vez o
cerrarlas todas para ver el resto.

- **Archivo**: nuevo, abrir, abrir carpeta, plantillas, recientes, guardar,
  exportar y salir.
- **Edición**: deshacer/rehacer, buscar y reemplazar, insertar índice y
  seleccionar todo.
- **Ver**: paneles, zoom, ancho de página, tema, corrector ortográfico e idioma.
- **Ayuda**: esta ayuda, enlaces de Iurefficient, buscar actualizaciones y versión.

## 4. Pestañas y ventanas

- Cada documento vive en una **pestaña**. Arrástralas para reordenarlas.
- El botón **+** (o Ctrl+N) abre una pestaña nueva.
- **Clic derecho** sobre una pestaña: recargar, cerrar, cerrar las demás/las de la
  derecha o **desacoplar** en una ventana nueva.
- El punto azul indica que la pestaña tiene **cambios sin guardar**.

## 5. Panel lateral

- **Archivos** (Ctrl+Shift+E): navega y abre los archivos de la carpeta actual y
  crea documentos y carpetas nuevos. Con **clic derecho** sobre un archivo puedes
  **renombrarlo** (ver «Enlaces entre notas»); sobre una carpeta, **usarla como
  bóveda**.
- **Buscar en archivos** (Ctrl+Shift+F, o la **lupa** del encabezado de
  Archivos): busca un texto en todos los archivos de la carpeta; pulsa un
  resultado para abrirlo en esa línea. La flecha ← (o Esc) vuelve al árbol.
- **Esquema** (Ctrl+Shift+O): lista los encabezados como un índice; pulsa uno
  para saltar a esa sección.
- **Enlaces** (Ctrl+Shift+K): qué notas enlazan a la que estás viendo y a cuáles
  enlaza ella (ver la sección siguiente).
- **Asistente** (Ctrl+Shift+J): preguntas a la IA de Iurefficient con tu cuenta
  conectada. Si el documento está guardado en un proyecto, busca en sus
  documentos y cita las fuentes; si no, usa el chat general. Bajo la pregunta
  eliges qué la acompaña: nada, la **selección** o el **documento** completo. El
  botón de la lupa **analiza el documento**: revisión de inconsistencias,
  resumen, qué le falta y, en un proyecto, contraste con el expediente.
  **Insertar** pone la respuesta tras el cursor y **Reemplazar**, en lugar de la
  selección. Cada pregunta gasta cuota de IA.

## 6. Enlaces entre notas

iureditor puede trabajar como un cuaderno de notas enlazadas, al estilo de
Obsidian: una nota apunta a otra con `[[Nombre de la nota]]` y puedes saltar
entre ellas, ver quién enlaza a quién y renombrar sin romper nada.

### La bóveda

Los enlaces se buscan dentro de una **bóveda**: la carpeta que contiene tus
notas (y sus subcarpetas). iureditor decide cuál es así:

1. La carpeta que abriste con **Archivo → Abrir carpeta…**, o la que marcaste con
   **clic derecho → Usar como bóveda** en el panel de Archivos (se señala con un
   pequeño icono de libros).
2. Si no, la carpeta más cercana que contenga una carpeta `.obsidian`: **una
   bóveda de Obsidian funciona tal cual**.
3. Si tampoco, la carpeta del documento que estás editando.

> [!TIP]
> Para empezar, crea una carpeta para tus notas y ábrela con **Archivo → Abrir
> carpeta…**. A partir de ahí, todas las notas de esa carpeta pueden enlazarse
> entre sí.

### Crear un enlace

Escribe **`[[`** y aparece una lista con las notas de la bóveda. Sigue escribiendo
para filtrarla (no hace falta escribir el nombre exacto ni los acentos) y pulsa
**Enter** o **Tab** para insertar el enlace. Si la nota no existe, la última opción
es **Crear nota «…»**.

| Escribes | Resultado |
| --- | --- |
| `[[Proyecto]]` | Enlace a la nota *Proyecto.md* |
| `[[Proyecto#Plan]]` | Enlace a la sección *Plan* de esa nota (tras `#` la lista ofrece sus encabezados) |
| `[[Proyecto|el proyecto]]` | Enlace que se lee «el proyecto» |
| `[[#Plan]]` | Enlace a una sección de la propia nota |
| `![[diagrama.png]]` | Incrustación: enlace a un archivo de la bóveda |

También puedes escribir el enlace completo a mano: al cerrar con **`]]`** se
convierte en enlace. En el archivo se guarda exactamente así, `[[…]]`, de modo que
tus notas siguen siendo Markdown portable.

### Usar los enlaces

- **Clic** en un enlace: abre la nota (y salta a la sección, si la indica). Un
  archivo que no es una nota se abre con la aplicación del sistema.
- Un enlace **gris y punteado** apunta a una nota que **aún no existe**; al
  pulsarlo se crea junto a la nota actual y se abre.
- Para **editar** un enlace, pon el cursor justo detrás y pulsa **Retroceso**:
  vuelve a ser texto `[[…` con la lista abierta.
- Los enlaces Markdown normales a otras notas (`[texto](otra-nota.md)`) también
  cuentan como enlaces.

### El panel Enlaces

Con **Ctrl+Shift+K** (o la pestaña **Enlaces** del panel lateral) ves, para la nota
activa:

- **Enlaces entrantes**: las notas que enlazan a esta, con la línea donde lo
  hacen. Pulsa una para abrirla justo en el enlace.
- **Enlaces salientes**: las notas a las que apunta esta (las que aún no existen,
  en gris; pulsarlas las crea).
- **Menciones sin enlazar**: notas que escriben el nombre de esta nota sin
  enlazarla; útil para descubrir conexiones.

Arriba se muestra qué bóveda se está usando y cuántas notas tiene.

> [!NOTE]
> El panel refleja lo **guardado**: guarda la nota (Ctrl+G) para ver sus enlaces
> nuevos. Los cambios hechos fuera de iureditor se leen al volver a su ventana.

### Renombrar sin romper enlaces

Clic derecho sobre un archivo en el panel de Archivos → **Renombrar…**. Si otras
notas enlazan a él, iureditor pregunta si quieres **actualizar** esos enlaces
(en disco y en las pestañas abiertas, sin perder los cambios sin guardar ni el
deshacer). Se conservan secciones y alias: `[[Idea|mi idea]]` pasa a
`[[Idea nueva|mi idea]]`.

### Ir a una nota y paleta de comandos

- **Ctrl+K — Ir a nota**: escribe parte del nombre de una nota (o de su carpeta)
  y pulsa Enter para abrirla. Si no existe, puedes crearla desde ahí.
- **Ctrl+Shift+P — Paleta de comandos**: busca y ejecuta cualquier acción de los
  menús por su nombre. En «Ir a nota», escribir `>` al principio también cambia
  a comandos.

## 7. Vista de código fuente

Con **Ctrl+Shift+M** alternas entre la vista visual y el **Markdown** en crudo, con
resaltado de sintaxis. Útil para ajustes finos o para pegar Markdown existente.

Con **Ctrl+Shift+N** muestras u ocultas los **números de línea** (en las dos
vistas). **Ctrl+L** salta a una línea concreta.

## 8. Insertar contenido

Desde la barra de herramientas o el menú «/» puedes insertar:

- **Encabezados** H1–H3, **listas** (con viñetas, numeradas y de tareas).
- **Formato**: negrita, cursiva, subrayado, tachado, código, sub/superíndice,
  color y resaltado.
- **Tablas**: inserta y edita filas y columnas.
- **Imágenes**: desde archivo o URL. Las locales se guardan con ruta relativa para
  que el documento sea portable.
- **Enlaces**, **citas**, **bloques de código**, **líneas horizontales**.
- **Diagramas Mermaid** con vista previa en vivo, plantillas y, con la cuenta de
  Iurefficient conectada, un **asistente** que los arma o modifica a partir de una
  descripción.
- **Notas al pie** y **fórmulas en línea** (LaTeX/KaTeX).
- **Callouts** (avisos como este):

> [!NOTE]
> Escribe `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, etc. al inicio de una cita
> para convertirla en un callout con color e icono.

- **Índice**: *Edición → Insertar índice* genera una tabla de contenidos a partir
  de los encabezados del documento.
- **Mapa mental**: con el cursor en una lista, el botón de mapa mental de la barra
  la convierte en mapa (el párrafo justo antes es el centro); otro clic lo deshace.
  También puedes escribir `/mapa` o `> [!MINDMAP] Centro` seguido de una lista
  con sangría. El mapa se dibuja junto a la lista mientras escribes: cada nivel
  de sangría es una rama. Negritas, cursivas y `[[enlaces]]` aparecen en el mapa.
  El mapa también se edita: un clic en un nodo lleva el cursor a su elemento de
  la lista (doble clic selecciona su texto) y la barra bajo el nodo añade una rama
  hija o hermana, la elimina o abre la nota enlazada (también con Ctrl+clic). En la cabecera eliges la forma de
  los nodos (subrayado, cuadrado, redondeado, círculo, nube, explosión o hexágono;
  se guarda como `> [!MINDMAP|bang]`) y la vista: lista con el mapa
  debajo, lista y mapa lado a lado, o sólo el mapa (la lista se oculta y se edita
  desde el mapa). Se guarda en el documento (`|right`, `|map`).
- **Mapa de enlaces**: `/enlaces` inserta un mapa mental con la nota al centro, sus
  `[[enlaces]]` como ramas, los enlaces de esas notas como subramas y una rama con
  las notas que la enlazan. Se edita como cualquier otro mapa, y el
  botón ⟳ de su cabecera lo regenera con los enlaces actuales (Ctrl+Z lo deshace). El PDF, DOCX y HTML exportados lo muestran como se ve: con la
  lista o, en la vista de sólo mapa, sólo el mapa.

## 9. El menú rápido «/»

Escribe **/** al principio de una línea vacía para abrir un menú de inserción
rápida (encabezados, listas, tabla, imagen, código, Mermaid, callout…). Filtra
escribiendo y confirma con Enter.

## 10. Buscar y reemplazar

**Ctrl+F** abre la barra de búsqueda, con resaltado de coincidencias, tanto en la
vista visual como en la de código fuente. **Ctrl+H** la abre con el campo de
**reemplazo** ya a la vista.

Para buscar en **todos los archivos de la carpeta**, usa **Ctrl+Shift+F** (la lupa
del panel de Archivos).

## 11. Exportar

Desde *Archivo → Exportar*:

- **PDF** (Ctrl+P): abre la vista previa de impresión; **Guardar PDF** escribe el
  archivo directamente (con su nombre y carpeta ya propuestos) y **Imprimir…**
  lo manda a una impresora. Respeta estilos, imágenes, diagramas y saltos de página.
- **DOCX**: documento de Word editable.
- **HTML**: página autónoma con los estilos incrustados.

## 12. Plantillas

Coloca archivos `.md` en la carpeta de plantillas (*Archivo → Nueva desde
plantilla → Abrir carpeta de plantillas*) y aparecerán como puntos de partida
para documentos nuevos.

## 13. Apariencia y lectura

- **Tema**: claro, oscuro o según el sistema.
- **Ancho de página** (Ctrl+Shift+A): medio, ancho o completo.
- **Zoom**: Ctrl++, Ctrl+- y Ctrl+0 para restablecer.
- **Corrector ortográfico**: actívalo o desactívalo desde *Ver*.
- **Language / Idioma**: español, inglés o automático (sigue el idioma del sistema),
  desde *Ver*.

## 14. Atajos de teclado

| Acción | Atajo |
| --- | --- |
| Nuevo / Abrir | Ctrl+N · Ctrl+O |
| Guardar / Guardar como | Ctrl+G · Ctrl+Shift+G |
| Exportar a PDF | Ctrl+P |
| Deshacer / Rehacer | Ctrl+Z · Ctrl+Shift+Z |
| Buscar / Reemplazar | Ctrl+F · Ctrl+H |
| Seleccionar todo | Ctrl+A |
| Panel de archivos / esquema | Ctrl+Shift+E · Ctrl+Shift+O |
| Buscar en archivos | Ctrl+Shift+F |
| Ir a nota | Ctrl+K |
| Paleta de comandos | Ctrl+Shift+P |
| Panel de enlaces | Ctrl+Shift+K |
| Código fuente | Ctrl+Shift+M |
| Números de línea / Ir a línea | Ctrl+Shift+N · Ctrl+L |
| Ayuda (este documento) | F1 |
| Ancho de página | Ctrl+Shift+A |
| Zoom + / − / normal | Ctrl++ · Ctrl+- · Ctrl+0 |
| Cerrar pestaña / Salir | Ctrl+W · Ctrl+Q |

## 15. Actualizaciones

En *Ayuda → Buscar actualizaciones…* compruebas si hay una versión nueva. La
versión instalada aparece al final del menú **Ayuda**.

---

*iureditor — un producto de [Iurefficient](https://iurefficient.com).*
