**Vista previa de IureEditor 2.0**, reescrito en Rust (sin navegador por dentro): arranca rápido,
usa menos memoria y comparte el editor de documentos con IureDesk e IureProject. Es una **alfa**:
convive con IureEditor 1.x (que sigue siendo el principal y se actualiza solo); instálala para
probarla junto a él.

## Descargas
- **Linux x86_64:** `iureditor2-…-x86_64-linux.tar.gz`: descomprimir y correr `./instalar.sh`
  (para tu usuario; `./desinstalar.sh` lo quita).
- **Windows 10/11 de 64 bits:** `iureditor2-…-x86_64-windows.zip`: descomprimir y abrir
  `iureditor2.exe`. Sin firma: si SmartScreen avisa, «Más información» › «Ejecutar de todas formas».
- **macOS 11 o posterior (universal):** `iureditor2-…-macos-universal.zip`: descomprimir y llevar
  «IureEditor 2» a Aplicaciones. Sin firma: la primera vez, clic derecho › Abrir.
- Verifica la descarga con `SHA256SUMS`.

## Novedades desde la alfa 3
- **El menú ☰ de la 1.x completo** (y se desplaza si no cabe): Iurefficient y Asistente; abrir
  carpeta, ir a nota (Ctrl+K), nueva desde plantilla, recientes; buscar, reemplazar, ir a línea,
  insertar índice, paleta de comandos (Ctrl+Mayús+P), seleccionar todo; archivos, esquema, enlaces,
  código fuente (Ctrl+Mayús+M), números de línea (Ctrl+Mayús+N, también con el texto con formato),
  zoom, ancho de página (medio, ancho, completo), tema, corrector ortográfico e idioma; ayuda (F1),
  buscar actualizaciones y «Acerca de».
- **Plantillas con campos**: las de arranque piden expediente, nombre, lugar… antes de crear el
  documento (las tuyas también, con `{{campo}}`).
- **Pestaña Iurefficient** (abrir y guardar documentos de tus casos), **asistente**, enlaces `[[`
  entre notas, fórmulas `$…$` dibujadas, color y resaltado del texto, mapas mentales editables desde
  el dibujo (a ambos lados del centro por omisión) y exportar diagramas a PNG o SVG.
- **Tipografía como la 1.x**: la fuente del escritorio por omisión, listas sin renglones de sobra,
  código en línea más chico; apariencia (fuente, tamaño, densidad) en Ver.
- Los enlaces de un índice (`[título](#ancla)`) llevan a su título.
- **Ya no se congela** en Linux con Wayland y tarjeta NVIDIA; la barra de desplazamiento va en la
  orilla de la ventana.

## Aún no
- No reemplaza a la 1.x: no registra `iureditor://` ni se actualiza sola («Buscar actualizaciones»
  avisa y abre la página de descargas).
- La ayuda (F1) es la de la 1.x: algunas pantallas se ven distintas.
