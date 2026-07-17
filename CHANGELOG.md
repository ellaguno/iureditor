# Changelog

Todas las versiones notables de iureditor. El cuerpo de cada release en GitHub
se genera automáticamente a partir de la sección correspondiente al tag
(`.github/workflows/release.yml`), así que para publicar unas notas basta con
añadir aquí la sección `## vX.Y.Z` antes de empujar el tag.

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
