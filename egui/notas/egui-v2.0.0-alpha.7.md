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

## Corregido desde la alfa 6
- **Re Pág / Av Pág** mueven el cursor y la vista una pantalla (también dentro de una lista larga).
- **Pegar desde Word o LibreOffice** una lista con niveles: conserva su estructura y su numeración
  (antes salían viñetas vacías y la numeración empezaba de nuevo en cada tramo).
- **Tab / Mayús+Tab con varias líneas elegidas** sangra o quita la sangría a todas; en una lista
  numerada, el elemento queda bajo el número de arriba.
- **Las listas numeradas se renumeran solas** al agregar, borrar o mover elementos (una sublista
  empieza en 1).
- **Pegar varias líneas en un mapa mental** (o en una cita): cada línea es un nodo.

## Aún no
- No reemplaza a la 1.x: no registra `iureditor://` ni se actualiza sola («Buscar actualizaciones»
  avisa y abre la página de descargas).
- La ayuda (F1) es la de la 1.x: algunas pantallas se ven distintas.
