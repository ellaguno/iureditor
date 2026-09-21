# Changelog

Todas las versiones notables de iureditor. El cuerpo de cada release en GitHub
se genera automáticamente a partir de la sección correspondiente al tag
(`.github/workflows/release.yml`), así que para publicar unas notas basta con
añadir aquí la sección `## vX.Y.Z` antes de empujar el tag.

## v1.8.1 — 2026-09-21

### Cambiado
- Los instaladores de la release se publican con nombre uniforme
  `iureditor_<versión>_1-windows-x64.exe`, `2-macos-universal.dmg`,
  `3-linux-x64.deb`… GitHub los lista por nombre, y así aparecen primero
  Windows, luego macOS y al final Linux. El `latest.json` del actualizador lo
  genera el propio flujo de publicación.

## v1.8.0 — 2026-09-21

### Añadido
- **Apps de Iurefficient** al pie del panel «Iurefficient»: las tres apps de
  escritorio (IureTranscribe, IureEditor e IureDav), cuáles están instaladas en
  este equipo, la última versión publicada y botones para abrirlas o descargarlas.
- **Enlaces `iureditor://`.** `iureditor://open?path=/ruta/doc.md` abre un
  archivo local (IureTranscribe lo usa para «Abrir con IureEditor») e
  `iureditor://iurefficient/doc?case=…&doc=…&name=…` descarga un documento de
  la instancia como espejo local y lo abre vinculado, listo para subir versiones.
- Usa el conector común `iurefficient-connect` 0.4.2.

## v1.7.0 — 2026-09-21

### Añadido
- **Panel «Iurefficient»** en la barra lateral (Ctrl+Shift+I, menú Ver). Conecta
  tu cuenta con correo y contraseña (y el código de dos pasos si lo tienes; la
  contraseña no se guarda, sólo la sesión en el llavero del sistema, compartida
  con IureTranscribe e IureDav), busca un proyecto y abre sus documentos Markdown
  o de texto directamente en el editor.
- **Guardar de vuelta como versión.** Un documento abierto desde Iurefficient se
  trabaja como un archivo normal (deshacer, borradores, imágenes) y, al guardar
  con Ctrl+S, sube una versión nueva a la instancia; se puede desactivar en el
  panel o subir a mano con «Subir versión ahora». Cualquier archivo local se
  puede enviar con «Guardar en Iurefficient…» a un proyecto o a General, y a
  partir de ahí queda vinculado.
- Usa el conector común
  [`iurefficient-connect`](https://github.com/ellaguno/iurefficient-connect).

## v1.6.1 — 2026-08-22

### Corregido
- **El panel de archivos sigue al documento activo**. Antes solo mostraba la
  carpeta de trabajo elegida a mano (botón de carpeta o navegación dentro del
  panel), así que al abrir un archivo sin haber elegido carpeta el panel
  quedaba vacío. Ahora, al abrir un archivo, guardarlo como o cambiar de
  pestaña, el panel muestra la carpeta de ese documento; la navegación manual
  del panel se respeta mientras no cambie la ruta del documento activo.

## v1.6.0 — 2026-08-22

### Añadido
- **Buscar en los archivos de la carpeta de trabajo** (Ctrl+Shift+F, tercera
  vista del panel lateral). Busca el término en todos los markdown y textos
  de la carpeta, agrupa los resultados por archivo con número de línea y
  vista previa, y al hacer clic abre el archivo en vista fuente saltando a
  esa línea.
- **Ir a línea** (Ctrl+L, menú Edición). En una pestaña en modo visual
  primero cambia a la vista de código fuente, que es donde las líneas del
  archivo existen tal cual.
- **La posición del cursor se recuerda por archivo**: al restaurar la sesión
  cada documento reabre donde se quedó el cursor, centrado en pantalla.

### Corregido
- **Pegar texto desde una terminal ya no añade retornos de más**. Las líneas
  contiguas de un párrafo (texto envuelto a 80 columnas, salida de comandos)
  se pegaban como párrafos sueltos, que al guardar ganaban una línea en
  blanco entre cada una. Ahora un salto simple se conserva como salto simple,
  tanto al pegar como en el viaje completo archivo → editor → archivo.
- **Los finales de línea CRLF (Windows) se conservan al guardar**. Antes,
  abrir y guardar un `.txt` o `.md` con finales CRLF los convertía todos a
  LF en silencio; ahora el estilo del archivo original se detecta al abrir
  y se repone al escribir.
- **Números de línea en la vista de código fuente** (menú Ver → Números de
  línea). Aplica tanto a archivos de texto plano como al fuente de un
  markdown; las líneas largas se envuelven con sangría bajo su número y la
  preferencia se recuerda entre sesiones.
- **"Guardar como" respeta extensiones de texto**: guardar un documento nuevo
  como `notas.txt` (o `.env`, `.csv`…) ya no le añade `.md` a la fuerza — se
  guarda el texto tal cual y la pestaña pasa a modo texto plano, igual que si
  el archivo se hubiera abierto del disco. El diálogo ofrece ahora también el
  filtro "Texto".

## v1.5.15 — 2026-08-06

### Añadido
- **Buscar y reemplazar en la vista de código fuente** (Ctrl+F). Antes la
  búsqueda solo existía en el editor visual, así que en un archivo que no es
  markdown (un `.sh`, un `.json`…), que siempre se abre en vista fuente,
  Ctrl+F no hacía nada. También estaba muerta al pasar un `.md` a vista
  fuente. Incluye navegación entre coincidencias, distinguir mayúsculas y
  reemplazar uno o todos, igual que en el editor visual.

## v1.5.14 — 2026-08-06

### Corregido
- **Diagramas ASCII con las líneas rotas**: los bloques de código heredaban el
  interlineado del texto normal (1.6), así que los caracteres de dibujo de
  caja (`│ ┌ ┴ …`) quedaban separados por un hueco vertical y las cajas no
  cerraban. Ahora el interlineado de todo bloque monoespaciado es ajustado y
  los diagramas se ven continuos.
- **Cajas descuadradas horizontalmente**: la fuente de los bloques de código
  era `Courier New`, que no incluye los caracteres de dibujo de caja; el
  sistema los sustituía por otra tipografía de ancho distinto. El nuevo stack
  monoespaciado sí los trae, así que las columnas alinean.
- El arreglo se aplica en los cinco sitios donde se ve código: editor visual,
  vista de código fuente, vista previa markdown, vista previa/export a PDF y
  export a HTML y DOCX. La vista previa de impresión no tenía ninguna regla
  propia para los bloques de código y heredaba el interlineado configurable
  del documento.
- Se desactivan las ligaduras tipográficas dentro de los bloques de código
  (fuentes como Fira Code fusionaban `--` o `|>` dentro de un diagrama).

## v1.5.13 — 2026-08-05

### Añadido
- **Pegar tablas ASCII como tablas reales**: al pegar salida de terminal con
  tablas de bordes `+---+` (MySQL, CLIs), cajas Unicode `┌─┬─┐` o el formato
  de psql (`----+----`), se convierten automáticamente en tablas markdown
  editables. La prosa alrededor se conserva intacta.
- **Pegar diagramas ASCII sin romper el alineado**: los bloques con pinta de
  diagrama (cajas con flechas, árboles `├──`) se envuelven en un bloque de
  código monoespaciado al pegar, en vez de deshacerse en párrafos.

### Corregido
- **Retornos de carro al pegar desde terminal**: el texto copiado con CRLF o
  CR sueltos rompía la conversión markdown (fences sin cerrar, párrafos
  fantasma). Ahora los fines de línea se normalizan antes de procesar el
  pegado.

## v1.5.12 — 2026-08-04

### Añadido
- **El esquema sigue al cursor**: con el panel lateral en «Esquema», la
  sección donde está el cursor se resalta y se mantiene a la vista; al hacer
  scroll sin mover el cursor, se resalta la sección visible en pantalla.
- **Número de línea en la barra de estado**: junto a palabras y caracteres se
  muestra la línea del cursor. En el editor visual cada bloque de texto cuenta
  como una línea (los bloques de código suman sus saltos internos); en la
  vista fuente es la línea exacta del archivo.

### Corregido
- **Contraste en mapas mentales mermaid**: el tema por defecto invertía el
  color del texto en dos de las secciones (blanco sobre relleno pastel,
  ilegible); ahora todas las etiquetas van en oscuro.
- **Etiquetas mermaid descentradas o recortadas al exportar PNG/DOCX**: el
  texto se medía con la fuente de la aplicación pero se rasterizaba con
  DejaVu Sans (más ancha). Los diagramas usan ahora la misma fuente en
  pantalla y en el export, así lo que se mide es lo que se dibuja.
- **HTML literal en diagramas mermaid**: etiquetas como `<b>` o `<i>`
  aparecían tal cual en el diagrama (los labels se dibujan como texto SVG, sin
  HTML); ahora se eliminan antes de renderizar. `<br>` se conserva como salto
  de línea.

### Rendimiento (documentos grandes)
- La serialización a markdown tras teclear (dirty-tracking, contadores)
  espacia su frecuencia en documentos de más de ~100 KB: la escritura ya no se
  congela a cada pausa.
- El autoguardado de borradores reutiliza el markdown ya emitido en vez de
  volver a serializar todo el documento.
- Los diagramas mermaid se renderizan en cola, uno a la vez y cediendo el hilo
  entre cada uno: al abrir un documento con decenas de diagramas la app pinta
  progresivamente en vez de congelarse. La cola también evita que un render
  normal se cuele en medio de un export con configuración temporal.
- Las imágenes cargan de forma perezosa (`loading="lazy"`) y, junto con los
  diagramas, no se pintan mientras están lejos del viewport
  (`content-visibility: auto`).

## v1.5.11 — 2026-07-29

### Corregido
- **Las imágenes ya no se rompen al «guardar como» en otra carpeta**: el
  documento conserva rutas relativas (`assets/logo.png`) para ser portable, así
  que al mudarlo de carpeta pasaban a buscarse donde no había nada y quedaban
  rotas en el editor y en los exports. Ahora, al guardar en una carpeta
  distinta:
  - Las imágenes que viven **dentro** de la carpeta del documento se **copian**
    a la misma ruta relativa bajo la carpeta nueva. El markdown no cambia y el
    documento sigue siendo portable. El original se queda donde estaba.
  - Las que viven **fuera** (p. ej. `../instance/img.png`, una biblioteca
    compartida) **no se duplican**: se reapunta la referencia a donde ya están.
  - Nunca se sobrescribe un archivo del destino: si ya hay uno distinto con ese
    nombre, la copia va a un nombre libre (`logo-1.png`) y se reapunta.
  - Las referencias que ya estaban rotas se dejan como estaban, y los ejemplos
    dentro de bloques de código no se tocan.

  Si hubo que reescribir rutas dentro del documento, se avisa (y con ello se
  reinicia el historial de deshacer). En el caso normal —copiar— no cambia nada
  para el usuario.

## v1.5.10 — 2026-07-29

### Corregido
- **Directorio por defecto de los diálogos, unificado**: «Guardar como…» sólo
  sugería el nombre del archivo, sin carpeta, así que el diálogo del sistema
  abría donde le apetecía y era fácil acabar guardando en el sitio equivocado;
  abrir, examinar imágenes y exportar (DOCX, HTML, SVG/PNG de diagramas)
  tampoco fijaban carpeta. Ahora todos parten del mismo sitio: la carpeta del
  documento activo si ya tiene ruta —tras un «guardar como» manda la carpeta
  nueva— y, si es un documento sin título, la última usada (abrir, guardar o la
  seleccionada en el panel de archivos).
- **El directorio por defecto sobrevive al reinicio**: se guarda en la sesión,
  en vez de volver al home hasta abrir o guardar algo.
- **Recarga por cambio externo**: al detectar que un archivo cambió en disco, se
  comprueba el contenido real de la pestaña en vez del indicador de «modificado»
  (que va un tick por detrás del teclado); las últimas pulsaciones ya no pueden
  perderse en una recarga silenciosa.

## v1.5.9 — 2026-07-27

### Cambios
- **Icono de la aplicación actualizado** en todas las plataformas.

### Corregido
- **Numeración de listas ordenadas con ítems multilínea**: un ítem cuyo texto
  continúa en líneas indentadas rompía la lista en varias listas de un solo
  elemento y todos se numeraban «1». Ahora las líneas de continuación se unen a
  su ítem, las líneas en blanco entre ítems (listas «loose») ya no rompen la
  lista, y una lista que no empieza en 1 conserva su número inicial
  (`<ol start="…">`).

## v1.5.8 — 2026-07-21

### Nuevo
- **Botón de callout en la barra de herramientas**: convierte el bloque actual en
  una **nota** (callout) con un clic; el tipo (nota, consejo, importante,
  advertencia, precaución) se cambia luego con el selector del propio bloque.
- **Ayuda integrada**: *Ayuda → Ayuda de iureditor* abre un documento con la guía
  de uso del editor (interfaz, barra de herramientas, menús, inserción de
  contenido, exportación y atajos), con imágenes y un índice navegable desde el
  panel **Esquema del documento**.

### Cambios
- **Menú principal más claro**: las secciones (Archivo, Edición, Ver, Ayuda) se
  ven ahora como cabeceras colapsables bien diferenciadas, con la sección activa
  resaltada, y se pueden **plegar todas** (antes no era posible cerrar la sección
  abierta para ver las de abajo).
- **Nuevo icono** de la aplicación en Windows, Linux y macOS.
- **Barra de herramientas**: se retira el botón de *fórmula en bloque*; se
  mantiene la *fórmula en línea*.

## v1.5.7 — 2026-07-20

### Nuevo
- **Instancia única**: abrir un documento con iureditor ya abierto ya no lanza
  otra ventana. La instancia viva recibe el foco y abre el archivo en una
  pestaña (si ya estaba abierto, solo la activa).
- **Menú contextual propio en las pestañas** (reemplaza el del navegador):
  **Recargar**, **Cerrar**, **Cerrar las demás**, **Cerrar las de la derecha** y
  **Desacoplar en ventana nueva**.
- **Desacoplar pestaña**: abre el documento en una ventana propia.

## v1.5.6 — 2026-07-20

### Nuevo
- **Menú de inserción «/»**: escribe `/` en el editor para insertar títulos,
  listas (viñetas, numerada, tareas), cita, bloque de código, tabla, diagrama
  mermaid, fórmula, separador y callouts. Filtrable y navegable con el teclado.
- **Vista fuente con resaltado de sintaxis** (estilo editor de código). Detecta
  el lenguaje por extensión, así que los archivos `.json`, `.yaml`, `.xml` y
  demás se abren coloreados.
- **Callouts / admoniciones** (nota, consejo, importante, advertencia,
  precaución) con icono, color y selector de tipo. Se guardan en markdown como
  `> [!TIPO]`, compatibles con GitHub/Obsidian.

## v1.5.5 — 2026-07-17

### Nuevo
- **Editor de diagramas mermaid mejorado**: al editar se abre un panel con el
  código a la izquierda y una **vista previa en vivo** a la derecha, más
  **plantillas** por tipo de diagrama (flujo, secuencia, clases, estados,
  entidad–relación, Gantt, pastel). `Tab` inserta espacios en vez de mover el
  foco.
- **Menú contextual en las imágenes** (reemplaza el del navegador): **«Abrir en
  editor externo»** —abre el asset con la app del sistema, pensado para editar
  SVG de draw.io— y **«Borrar imagen»**. Al volver a la app tras editar afuera,
  la imagen se refresca automáticamente.

## v1.5.4 — 2026-07-17

### Nuevo
- **Pegar imágenes del portapapeles** a `assets/` junto al documento. En Linux
  (WebKitGTK) el evento *paste* del DOM no entrega los bytes de una captura, así
  que se leen desde el portapapeles del sistema con un comando nativo
  (`read_clipboard_image`, basado en `arboard`, con soporte X11 y Wayland).
- **Menú contextual en el panel de archivos** (reemplaza el del navegador):
  nuevo archivo, nueva carpeta, subir un directorio y recargar. Se añadieron
  además botones equivalentes en la cabecera del panel.
- **Doble clic en una carpeta** para abrirla como carpeta de trabajo (raíz).
- **Menú contextual Editar / Borrar en las fórmulas**, que permite eliminar
  fórmulas rotas o vacías que antes quedaban atascadas.

## v1.5.3 — 2026-07-16

### Nuevo
- Atajos de teclado en español.
- Crear archivos directamente desde el panel de archivos.

### Corregido
- Sesión duplicada al reabrir la aplicación.

## v1.5.2

### Nuevo
- Ancho de página configurable (columna de lectura centrada).

## v1.5.1

### Corregido
- Carga de documentos Markdown con HTML embebido e imágenes fuera del
  directorio del documento.

## v1.5.0

### Nuevo
- Panel lateral de archivos de la carpeta de trabajo.
