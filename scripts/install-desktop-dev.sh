#!/usr/bin/env bash
# Instala (a nivel usuario) la entrada .desktop y los íconos de iureditor
# para desarrollo en Linux. GNOME toma el ícono de la app del .desktop que
# coincide con el WM_CLASS de la ventana — sin esto, en `tauri dev` se ve
# el ícono genérico. Los paquetes .deb/AppImage instalan lo suyo propio.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS_SRC="$REPO_DIR/src-tauri/icons"
BIN="$REPO_DIR/src-tauri/target/debug/iureditor"

ICON_BASE="$HOME/.local/share/icons/hicolor"
declare -A SIZES=(
  [32x32]="32x32.png"
  [64x64]="64x64.png"
  [128x128]="128x128.png"
  [256x256]="128x128@2x.png"
)
for size in "${!SIZES[@]}"; do
  mkdir -p "$ICON_BASE/$size/apps"
  cp "$ICONS_SRC/${SIZES[$size]}" "$ICON_BASE/$size/apps/iureditor.png"
done

APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/iureditor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=iureditor
Comment=Editor WYSIWYG de Markdown
Exec=$BIN %f
Icon=iureditor
Terminal=false
Categories=Office;TextEditor;
MimeType=text/markdown;
StartupWMClass=iureditor
EOF

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS_DIR" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -t "$ICON_BASE" 2>/dev/null || true

echo "Instalado: $APPS_DIR/iureditor.desktop (Exec=$BIN)"
echo "Puede requerir cerrar sesión o reiniciar gnome-shell para refrescar el ícono."
