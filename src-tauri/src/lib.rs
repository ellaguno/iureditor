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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![allow_asset_dir, print_webview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
