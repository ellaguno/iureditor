mod iurefficient;

use tauri::{Emitter, Manager};

/// Primer argumento de la línea de comandos que sea un archivo existente,
/// canonicalizado. Se usa tanto al arrancar (`get_cli_file`) como cuando una
/// segunda instancia le pasa su argv a la instancia viva.
fn first_file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find_map(|arg| {
        // Enlace `iureditor://open?path=/ruta/doc.md` (desde otra app o el navegador).
        let candidate = deep_link_path(arg).unwrap_or_else(|| arg.clone());
        let path = std::path::Path::new(&candidate);
        if path.is_file() {
            path.canonicalize()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        } else {
            None
        }
    })
}

/// Ruta local de un enlace `iureditor://open?path=…` (o `file://…`); None si no lo es.
fn deep_link_path(arg: &str) -> Option<String> {
    let lower = arg.to_ascii_lowercase();
    if lower.starts_with("file:") {
        return url::Url::parse(arg).ok().and_then(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
    }
    if !lower.starts_with("iureditor:") {
        return None;
    }
    let u = url::Url::parse(arg).ok()?;
    u.query_pairs().find(|(k, _)| k == "path").map(|(_, v)| v.into_owned())
}

/// Enlace `iureditor://iurefficient/doc?case=<id>&doc=<id>&name=<archivo>&title=<proyecto>`:
/// abrir un documento de la instancia (se descarga como espejo local).
#[derive(Clone, serde::Serialize)]
struct IureDocLink {
    case_id: Option<String>,
    case_title: Option<String>,
    document_id: String,
    file_name: String,
}

fn iure_doc_link(arg: &str) -> Option<IureDocLink> {
    if !arg.to_ascii_lowercase().starts_with("iureditor:") {
        return None;
    }
    let u = url::Url::parse(arg).ok()?;
    let route = format!("{}{}", u.host_str().unwrap_or(""), u.path());
    if !route.trim_end_matches('/').ends_with("iurefficient/doc") {
        return None;
    }
    let get = |k: &str| u.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty());
    Some(IureDocLink {
        case_id: get("case"),
        case_title: get("title"),
        document_id: get("doc")?,
        file_name: get("name").unwrap_or_else(|| "documento.md".into()),
    })
}

/// Enlace `iureditor://iurefficient/doc…` con el que se abrió la app, si lo hubo.
#[tauri::command]
fn get_cli_iure_doc() -> Option<IureDocLink> {
    std::env::args().skip(1).find_map(|a| iure_doc_link(&a))
}

/// Apps de escritorio de Iurefficient en este equipo y su última versión publicada.
#[tauri::command]
async fn apps_status(with_network: bool) -> Vec<iurefficient_connect::apps::AppStatus> {
    if with_network {
        iurefficient_connect::apps::status(&iurefficient_connect::user_agent("IureEditor", env!("CARGO_PKG_VERSION"))).await
    } else {
        iurefficient_connect::apps::installed()
    }
}

#[tauri::command]
fn launch_app(app: String, path: Option<String>) -> Result<(), String> {
    let id = iurefficient_connect::apps::AppId::parse(&app).ok_or_else(|| format!("app desconocida: {app}"))?;
    let args: Vec<String> = path.into_iter().collect();
    iurefficient_connect::apps::launch(id, &args).map_err(|e| format!("{e:#}"))
}

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
    first_file_arg(&std::env::args().collect::<Vec<_>>())
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

/// Lee una imagen del portapapeles del sistema y la devuelve como PNG en
/// base64 (o `None` si el portapapeles no contiene una imagen). Necesario
/// porque en Linux WebKitGTK no expone los bytes de una captura a través del
/// evento `paste` del DOM; el frontend usa esto como respaldo al pegar.
/// async: arboard puede tardar un poco en dialogar con el servidor de
/// portapapeles y no queremos congelar el hilo de UI.
#[tauri::command]
async fn read_clipboard_image() -> Result<Option<String>, String> {
    use base64::Engine as _;

    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let img = match clipboard.get_image() {
        Ok(img) => img,
        // Sin imagen en el portapapeles (o formato no soportado): no es error.
        Err(_) => return Ok(None),
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    {
        let mut encoder =
            png::Encoder::new(&mut png_bytes, img.width as u32, img.height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&img.bytes)
            .map_err(|e| e.to_string())?;
    }
    Ok(Some(
        base64::engine::general_purpose::STANDARD.encode(png_bytes),
    ))
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
        // Debe ir primero (recomendación del plugin): si hay otra instancia,
        // este callback corre en la instancia viva con el argv del proceso
        // nuevo, que ya se cerró. Enfocamos la ventana principal y, si trae un
        // archivo, lo abrimos ahí (el frontend deduplica por ruta).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(file) = first_file_arg(&argv) {
                    let _ = window.emit("open-file", file);
                } else if let Some(link) = argv.iter().find_map(|a| iure_doc_link(a)) {
                    let _ = window.emit("iure-open-doc", link);
                }
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
            get_cli_iure_doc,
            apps_status,
            launch_app,
            print_webview,
            render_svg_png,
            read_clipboard_image,
            iurefficient::iure_status,
            iurefficient::iure_login,
            iurefficient::iure_logout,
            iurefficient::iure_cases,
            iurefficient::iure_case_documents,
            iurefficient::iure_open_document,
            iurefficient::iure_mirror_of,
            iurefficient::iure_upload_version,
            iurefficient::iure_save_new
        ])
        .setup(|app| {
            #[cfg(target_os = "linux")]
            enable_spellcheck(app);
            // Esquema `iureditor://` (Linux y Windows lo registran en tiempo de
            // ejecución; en macOS va en el Info.plist del bundle).
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("no se pudo registrar el esquema iureditor://: {e}");
                }
            }
            iurefficient::init(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
