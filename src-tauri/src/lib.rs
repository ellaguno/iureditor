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

/// Archivo pasado por línea de comandos (doble clic en un .md con la
/// asociación de archivos, o `iureditor doc.md`). El frontend lo consulta
/// al arrancar.
#[tauri::command]
fn get_cli_file() -> Option<String> {
    let arg = std::env::args().nth(1)?;
    let path = std::path::Path::new(&arg);
    if path.is_file() {
        path.canonicalize()
            .ok()
            .map(|p| p.to_string_lossy().into_owned())
    } else {
        None
    }
}

/// Fallback de impresión: window.print() no es fiable en todos los webviews
/// (WKWebView en macOS); este comando usa la API nativa de wry.
#[tauri::command]
fn print_webview(webview: tauri::WebviewWindow) -> Result<(), String> {
    webview.print().map_err(|e| e.to_string())
}

/// Fuentes del sistema cacheadas: load_system_fonts() tarda y se usaba en
/// cada rasterización.
fn font_database() -> std::sync::Arc<resvg::usvg::fontdb::Database> {
    static FONTDB: std::sync::OnceLock<std::sync::Arc<resvg::usvg::fontdb::Database>> =
        std::sync::OnceLock::new();
    FONTDB
        .get_or_init(|| {
            let mut fontdb = resvg::usvg::fontdb::Database::new();
            fontdb.load_system_fonts();
            fontdb.set_sans_serif_family("DejaVu Sans");
            std::sync::Arc::new(fontdb)
        })
        .clone()
}

/// Lógica de rasterización, separada del comando para poder testearla.
fn rasterize_svg(svg: &str, scale: f32) -> Result<String, String> {
    use base64::Engine as _;
    use resvg::{tiny_skia, usvg};

    let opt = usvg::Options {
        fontdb: font_database(),
        ..usvg::Options::default()
    };

    let tree = usvg::Tree::from_str(svg, &opt).map_err(|e| e.to_string())?;
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

/// Rasteriza un SVG a PNG (devuelve base64). Se hace en Rust con resvg
/// porque WebKitGTK contamina el canvas al dibujar SVGs (SecurityError en
/// toBlob), lo que rompía el export de diagramas mermaid a PNG/DOCX.
/// async: los comandos síncronos corren en el hilo principal y una
/// rasterización grande congelaba la UI ("la aplicación no responde").
#[tauri::command]
async fn render_svg_png(svg: String, scale: f32) -> Result<String, String> {
    rasterize_svg(&svg, scale)
}

#[cfg(test)]
mod tests {
    #[test]
    fn rasteriza_svg_de_mermaid() {
        let path = std::env::var("IUR_TEST_SVG")
            .unwrap_or_else(|_| "../src/test/fixtures/diagram.svg".to_string());
        let svg = std::fs::read_to_string(&path).expect("no se pudo leer el SVG de prueba");
        let b64 = super::rasterize_svg(&svg, 2.0).expect("rasterización falló");
        assert!(b64.len() > 1000, "PNG sospechosamente pequeño");
        if let Ok(out) = std::env::var("IUR_TEST_PNG_OUT") {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&b64)
                .unwrap();
            std::fs::write(out, bytes).unwrap();
        }
    }
}

/// En Linux, WebKitGTK trae la corrección ortográfica desactivada a nivel
/// del contexto del webview; el atributo HTML `spellcheck` del editor no
/// hace nada sin esto. Los idiomas salen del locale del sistema (enchant
/// ignora los que no tengan diccionario hunspell instalado).
#[cfg(target_os = "linux")]
fn enable_spellcheck(app: &tauri::App) {
    use webkit2gtk::{WebContextExt, WebViewExt};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| {
        let Some(context) = webview.inner().context() else {
            return;
        };
        context.set_spell_checking_enabled(true);

        let locale = std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LC_MESSAGES"))
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_default();
        // "es_ES.UTF-8" → "es_ES"; añade el idioma base ("es") como fallback
        // por si no hay diccionario para la variante exacta.
        let base = locale.split(['.', '@']).next().unwrap_or("");
        let mut langs: Vec<&str> = Vec::new();
        let short = base.split('_').next().unwrap_or("");
        if !base.is_empty() && base != "C" && base != "POSIX" {
            langs.push(base);
            if short != base {
                langs.push(short);
            }
        } else {
            langs.push("en_US");
        }
        context.set_spell_checking_languages(&langs);
    });
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
            get_cli_file,
            print_webview,
            render_svg_png
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            enable_spellcheck(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
