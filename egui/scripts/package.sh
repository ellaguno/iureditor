#!/usr/bin/env bash
# Empaqueta IureEditor 2.0 (alfa) para un sistema: `package.sh linux|windows|macos <versión>`.
# Deja en egui/dist/ un archivo listo para la Release. Convive con IureEditor 1.x (Tauri): el
# binario se llama `iureditor2` y no registra el esquema `iureditor://`.
#
# Lo usa .github/workflows/release-egui.yml; en Linux también se puede correr a mano.
set -euo pipefail

OS="${1:?uso: package.sh linux|windows|macos <versión>}"
VERSION="${2:?falta la versión}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
ICONS="$REPO/src-tauri/icons"
DIST="$HERE/dist"
NAME="iureditor2-$VERSION"
mkdir -p "$DIST"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

case "$OS" in
  linux)
    BIN="$HERE/target/release/iureditor2"
    D="$STAGE/$NAME"
    mkdir -p "$D"
    cp "$BIN" "$D/iureditor2"
    strip "$D/iureditor2" 2>/dev/null || true
    cp "$REPO/LICENSE" "$D/LICENSE"
    cp "$ICONS/128x128.png" "$D/iureditor2.png"
    cat > "$D/instalar.sh" <<'EOF'
#!/usr/bin/env bash
# Instala IureEditor 2.0 (alfa) para este usuario: ~/.local/bin/iureditor2 y su entrada en el
# menú. No toca IureEditor 1.x ni el esquema iureditor://. Para quitarlo: desinstalar.sh.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/128x128/apps"
install -m 755 iureditor2 "$HOME/.local/bin/iureditor2"
install -m 644 iureditor2.png "$HOME/.local/share/icons/hicolor/128x128/apps/iureditor2.png"
cat > "$HOME/.local/share/applications/iureditor2.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=IureEditor 2.0 (alfa)
Comment=Editor de documentos Markdown
Exec=$HOME/.local/bin/iureditor2 %F
Icon=iureditor2
Terminal=false
Categories=Office;TextEditor;
MimeType=text/markdown;
StartupWMClass=iureditor2
DESK
command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" || true
echo "IureEditor 2.0 instalado: búscalo en el menú o corre ~/.local/bin/iureditor2"
EOF
    cat > "$D/desinstalar.sh" <<'EOF'
#!/usr/bin/env bash
rm -f "$HOME/.local/bin/iureditor2" "$HOME/.local/share/applications/iureditor2.desktop" \
  "$HOME/.local/share/icons/hicolor/128x128/apps/iureditor2.png"
echo "IureEditor 2.0 desinstalado (tus documentos no se tocan)."
EOF
    chmod +x "$D/instalar.sh" "$D/desinstalar.sh"
    tar -C "$STAGE" -czf "$DIST/$NAME-x86_64-linux.tar.gz" "$NAME"
    ;;
  windows)
    D="$STAGE/$NAME"
    mkdir -p "$D"
    cp "$HERE/target/release/iureditor2.exe" "$D/iureditor2.exe"
    cp "$REPO/LICENSE" "$D/LICENSE.txt"
    (cd "$STAGE" && 7z a -tzip "$DIST/$NAME-x86_64-windows.zip" "$NAME" >/dev/null)
    ;;
  macos)
    # .app universal (arm64 + x86_64) sin firma: la alfa se abre con clic derecho › Abrir.
    APP="$STAGE/IureEditor 2.app"
    mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
    lipo -create -output "$APP/Contents/MacOS/iureditor2" \
      "$HERE/target/aarch64-apple-darwin/release/iureditor2" \
      "$HERE/target/x86_64-apple-darwin/release/iureditor2"
    cp "$ICONS/icon.icns" "$APP/Contents/Resources/iureditor2.icns"
    cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>IureEditor 2</string>
  <key>CFBundleDisplayName</key><string>IureEditor 2.0 (alfa)</string>
  <key>CFBundleIdentifier</key><string>com.ellaguno.iureditor2</string>
  <key>CFBundleExecutable</key><string>iureditor2</string>
  <key>CFBundleIconFile</key><string>iureditor2</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION%%-*}</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
EOF
    cp "$REPO/LICENSE" "$STAGE/LICENSE.txt"
    (cd "$STAGE" && ditto -c -k --keepParent "IureEditor 2.app" "$DIST/$NAME-macos-universal.zip")
    ;;
  *)
    echo "sistema desconocido: $OS" >&2
    exit 1
    ;;
esac
ls -la "$DIST"
