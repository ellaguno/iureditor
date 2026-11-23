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

## Nuevo desde la alfa 5
- **Diagramas Mermaid editables desde el dibujo.** Un clic en un elemento abre su barra; un clic en
  un hueco ofrece agregar:
  - **Flujo**: agregar el siguiente paso (eligiendo su forma), conectar con otro paso, cambiar
    texto, forma o color, eliminar; en una flecha, su texto, tipo, sentido o eliminarla.
  - **Cuadrantes**: agregar un punto donde pulsas, arrastrarlo (con una guía de coordenadas),
    cambiar su color y tamaño; cambiar el título, los cuadrantes y los ejes.
  - **Secuencia, pastel, línea de tiempo, Kanban, Gantt** (arrastrar una barra cambia su fecha),
    **clases** y **entidad-relación**.
  - Todo con el teclado: Tab recorre los elementos e Intro abre su barra.
- Soltar una imagen ya no pega lo que hubiera copiado en otra app.

## Aún no
- No reemplaza a la 1.x: no registra `iureditor://` ni se actualiza sola («Buscar actualizaciones»
  avisa y abre la página de descargas).
- La ayuda (F1) es la de la 1.x: algunas pantallas se ven distintas.
