//! IureEditor 2.0 (S1.15 de la suite Iurefficient), primera entrega: abrir, escribir y guardar
//! Markdown con el editor de documentos de la suite (`DocEditor` por bloques, el mismo de las notas
//! de IureDesk y de IureProject). Convive con IureEditor Tauri hasta la paridad.
//!
//! Uso: `iureditor2 [archivo.md…]`; sin ventana, `iureditor2 --export entrada.md salida.(html|docx|pdf)`
//! o `iureditor2 --mcp` (servidor MCP por stdio: exportar, convertir, plantillas).

mod app;
mod diagrams;
mod doc;
mod drafts;
mod export;
mod mcp;
mod templates;

use std::process::ExitCode;

fn main() -> ExitCode {
    iurefficient_ui::lang::set_lang(iurefficient_ui::lang::detect());
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    if args.first().is_some_and(|a| a == "--mcp") {
        return ExitCode::from(u8::try_from(mcp::run_stdio()).unwrap_or(1));
    }
    if args.first().is_some_and(|a| a == "--export") {
        return export_cli(args.get(1), args.get(2));
    }
    // Los archivos de la línea de órdenes, uno por pestaña; sin ninguno, la sesión anterior.
    let mut docs = Vec::new();
    let mut notice = None;
    for arg in args.into_iter().take(64) {
        let path = std::path::PathBuf::from(arg);
        match doc::Doc::open(&path) {
            Ok(d) => docs.push(d),
            // Un archivo nuevo: se crea al guardar.
            Err(doc::DocError::Io(_)) if !path.exists() => {
                docs.push(doc::Doc { path: Some(path), ..Default::default() });
            }
            Err(e) => notice = Some(e.human(&path)),
        }
    }
    let mut active = docs.len().saturating_sub(1);
    if docs.is_empty()
        && let Some(f) = drafts::session_file()
    {
        let (paths, a) = drafts::load_session(&f);
        docs = paths.iter().filter_map(|p| doc::Doc::open(p).ok()).collect();
        active = a;
    }
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("IureEditor")
            .with_app_id("iureditor2")
            .with_inner_size([1000.0, 760.0]),
        ..Default::default()
    };
    let result = eframe::run_native(
        "IureEditor",
        options,
        Box::new(move |_cc| {
            let mut app = app::EditorApp::with_docs(docs, active, notice);
            // ¿Quedaron borradores de un cierre inesperado?
            app.recovery = drafts::drafts_dir().map(|d| drafts::orphans(&d)).unwrap_or_default();
            Ok(Box::new(Window(app)))
        }),
    );
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("IureEditor: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `--export entrada.md salida.html|docx`: exporta sin abrir la ventana.
fn export_cli(input: Option<&std::ffi::OsString>, output: Option<&std::ffi::OsString>) -> ExitCode {
    use iurefficient_ui::lang::pick;
    let (Some(input), Some(output)) = (input, output) else {
        eprintln!("{} iureditor2 --export entrada.md salida.(html|docx|pdf)", pick("usage:", "uso:"));
        return ExitCode::FAILURE;
    };
    let (input, output) = (std::path::PathBuf::from(input), std::path::PathBuf::from(output));
    let format = match output.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("html" | "htm") => export::Format::Html,
        Some("docx") => export::Format::Docx,
        Some("pdf") => export::Format::Pdf,
        _ => {
            eprintln!(
                "{}",
                pick("The output must end in .html, .docx or .pdf.", "La salida debe terminar en .html, .docx o .pdf.")
            );
            return ExitCode::FAILURE;
        }
    };
    let doc = match doc::Doc::open(&input) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{}", e.human(&input));
            return ExitCode::FAILURE;
        }
    };
    let base = input.canonicalize().ok().and_then(|p| p.parent().map(std::path::Path::to_path_buf));
    match export::export(&doc.text, base, format, &output) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

struct Window(app::EditorApp);

impl eframe::App for Window {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.0.ui(ui);
    }

    /// El fondo del tema (el de eframe es casi negro y se asomaba en modo claro).
    fn clear_color(&self, visuals: &egui::Visuals) -> [f32; 4] {
        visuals.panel_fill.to_normalized_gamma_f32()
    }
}
