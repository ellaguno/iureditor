use tauri::Manager;

/// Permite al asset protocol servir imágenes del directorio del documento
/// abierto (referencias relativas tipo `assets/img-*.png`).
#[tauri::command]
fn allow_asset_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let scope = app.asset_protocol_scope();
    scope
        .allow_directory(std::path::Path::new(&path), true)
        .map_err(|e| e.to_string())
}

/// Fallback de impresión: window.print() no es fiable en todos los webviews
/// (WKWebView en macOS); este comando usa la API nativa de wry.
#[tauri::command]
fn print_webview(webview: tauri::WebviewWindow) -> Result<(), String> {
    webview.print().map_err(|e| e.to_string())
}

/// Rasteriza un SVG a PNG (devuelve base64). Se hace en Rust con resvg
/// porque WebKitGTK contamina el canvas al dibujar SVGs (SecurityError en
/// toBlob), lo que rompía el export de diagramas mermaid a PNG/DOCX.
#[tauri::command]
fn render_svg_png(svg: String, scale: f32) -> Result<String, String> {
    use base64::Engine as _;
    use resvg::{tiny_skia, usvg};

    let mut fontdb = usvg::fontdb::Database::new();
    fontdb.load_system_fonts();
    fontdb.set_sans_serif_family("DejaVu Sans");
    let opt = usvg::Options {
        fontdb: std::sync::Arc::new(fontdb),
        ..usvg::Options::default()
    };

    let tree = usvg::Tree::from_str(&svg, &opt).map_err(|e| e.to_string())?;
    let size = tree.size();
    let scale = if scale > 0.0 { scale } else { 2.0 };
    let w = (size.width() * scale).ceil().max(1.0) as u32;
    let h = (size.height() * scale).ceil().max(1.0) as u32;
    if w > 16384 || h > 16384 {
        return Err(format!("SVG demasiado grande: {w}x{h}px"));
    }

    let mut pixmap =
        tiny_skia::Pixmap::new(w, h).ok_or_else(|| "no se pudo asignar el pixmap".to_string())?;
    pixmap.fill(tiny_skia::Color::WHITE);
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    let png = pixmap.encode_png().map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            // Restaurar sólo tamaño/posición/maximizado: si restaurase
            // DECORATIONS, el estado guardado de una sesión anterior (con
            // barra nativa) pisaría el decorations:false del config.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            allow_asset_dir,
            print_webview,
            render_svg_png
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
