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

## Qué trae
- Editor por bloques con formato al teclear (títulos, listas, tareas, citas, código resaltado),
  tablas, diagramas Mermaid y mapas mentales, e imágenes en su lugar; pegar desde la web, Word o
  Google Docs; pegar y soltar imágenes; corrector ortográfico; buscar y reemplazar.
- Pestañas, recuperación de borradores tras un cierre inesperado y la sesión al volver a abrir.
- **Exportar** a PDF, Word y página web (también sin ventana: `iureditor2 --export nota.md nota.pdf`).
- `iureditor2 --mcp` para que IureDesk, Claude o Copilot exporten y creen documentos desde
  plantillas sin abrir la ventana.
- Enlaces `iureditor2 "iureditor://insert?text=…"` (dictado de IureVoz) y una sola ventana.

## Aún no
- No reemplaza a la 1.x: no registra `iureditor://` ni se actualiza sola.
- Falta: abrir documentos de Iurefficient, el asistente, preferencias y documentos recientes de
  la 1.x.
