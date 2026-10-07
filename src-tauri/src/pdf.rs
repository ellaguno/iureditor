//! «Guardar PDF» directo: escribe la vista previa (ya paginada por paged.js)
//! a un archivo sin pasar por el diálogo de impresión del sistema, que para un
//! usuario nuevo es confuso (elegir la impresora «Imprimir a un archivo»,
//! cambiar el nombre y la carpeta…). Cada sistema tiene su API nativa:
//!
//! - Linux: `WebKitPrintOperation::print()` (sin diálogo) con la impresora
//!   virtual de archivo de GTK y `output-uri` apuntando al destino.
//! - Windows: `ICoreWebView2_7::PrintToPdf` de WebView2.
//! - macOS: `NSPrintOperation` de WKWebView con `NSPrintSaveJob` y sin paneles.
//!
//! paged.js ya dibuja cada hoja con sus márgenes; aquí el papel se fija al
//! mismo tamaño y los márgenes del motor de impresión a cero.

use iurefficient_connect::tr;

/// Tamaño del papel en pulgadas (ancho, alto).
#[cfg_attr(target_os = "linux", allow(dead_code))]
fn paper_inches(paper: &str) -> (f64, f64) {
    if paper.eq_ignore_ascii_case("a4") {
        (8.267_716, 11.692_913)
    } else {
        (8.5, 11.0)
    }
}

type Done = std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>>;

fn finish(done: &Done, result: Result<(), String>) {
    if let Some(tx) = done.lock().ok().and_then(|mut g| g.take()) {
        let _ = tx.send(result);
    }
}

#[tauri::command]
pub async fn save_pdf(webview: tauri::WebviewWindow, path: String, paper: String) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let done: Done = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let started = std::time::SystemTime::now();
    {
        let done = done.clone();
        let path = path.clone();
        webview
            .with_webview(move |pw| {
                if let Err(e) = start(pw, &path, &paper, done.clone()) {
                    finish(&done, Err(e));
                }
            })
            .map_err(|e| e.to_string())?;
    }
    rx.await.map_err(|_| tr!("the PDF export was interrupted", "la exportación a PDF se interrumpió"))??;
    // macOS no avisa al terminar: espera a que el archivo exista y deje de crecer.
    if cfg!(target_os = "macos") {
        wait_for_file(&path, started).await?;
    }
    Ok(())
}

async fn wait_for_file(path: &str, started: std::time::SystemTime) -> Result<(), String> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let mut last_len = None;
        for _ in 0..240 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            let fresh = meta.modified().map(|m| m >= started).unwrap_or(true);
            if fresh && meta.len() > 0 {
                if last_len == Some(meta.len()) {
                    return Ok(());
                }
                last_len = Some(meta.len());
            }
        }
        Err(tr!("the PDF was not written in time", "el PDF no se escribió a tiempo"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "linux")]
fn start(pw: tauri::webview::PlatformWebview, path: &str, paper: &str, done: Done) -> Result<(), String> {
    use webkit2gtk::PrintOperationExt;

    // La impresora virtual de archivo se llama con el texto traducido de GTK
    // («Print to File», «Imprimir a un archivo»…) y WebKit la busca por nombre.
    let file_printer = glib::dgettext(Some("gtk30"), "Print to File").to_string();

    let settings = gtk::PrintSettings::new();
    settings.set_printer(&file_printer);
    let uri = url::Url::from_file_path(path)
        .map_err(|_| tr!("invalid path: {path}", "ruta no válida: {path}"))?;
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_URI, Some(uri.as_str()));
    settings.set(gtk::PRINT_SETTINGS_OUTPUT_FILE_FORMAT, Some("pdf"));

    let paper_size = gtk::PaperSize::new(Some(if paper.eq_ignore_ascii_case("a4") {
        "iso_a4"
    } else {
        "na_letter"
    }));
    settings.set_paper_size(&paper_size);
    let setup = gtk::PageSetup::new();
    setup.set_paper_size(&paper_size);
    setup.set_orientation(gtk::PageOrientation::Portrait);
    for set in [
        gtk::PageSetup::set_top_margin,
        gtk::PageSetup::set_bottom_margin,
        gtk::PageSetup::set_left_margin,
        gtk::PageSetup::set_right_margin,
    ] {
        set(&setup, 0.0, gtk::Unit::Mm);
    }

    let op = webkit2gtk::PrintOperation::new(&pw.inner());
    op.set_print_settings(&settings);
    op.set_page_setup(&setup);
    {
        let done = done.clone();
        op.connect_failed(move |_, err| finish(&done, Err(err.to_string())));
    }
    // `finished` también se emite tras `failed`; finish() sólo envía el primero.
    op.connect_finished(move |_| finish(&done, Ok(())));
    op.print();
    Ok(())
}

#[cfg(windows)]
fn start(pw: tauri::webview::PlatformWebview, path: &str, paper: &str, done: Done) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let (w, h) = paper_inches(paper);
    unsafe {
        let webview: ICoreWebView2_7 = pw
            .controller()
            .CoreWebView2()
            .and_then(|c| c.cast())
            .map_err(|e| e.to_string())?;
        let env: ICoreWebView2Environment6 = pw.environment().cast().map_err(|e| e.to_string())?;
        let settings = env.CreatePrintSettings().map_err(|e| e.to_string())?;
        (|| -> windows::core::Result<()> {
            settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
            settings.SetPageWidth(w)?;
            settings.SetPageHeight(h)?;
            settings.SetMarginTop(0.0)?;
            settings.SetMarginBottom(0.0)?;
            settings.SetMarginLeft(0.0)?;
            settings.SetMarginRight(0.0)?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            Ok(())
        })()
        .map_err(|e| e.to_string())?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            finish(
                &done,
                match result {
                    Err(e) => Err(e.to_string()),
                    Ok(()) if !ok => Err(tr!("WebView2 could not write the PDF", "WebView2 no pudo escribir el PDF")),
                    Ok(()) => Ok(()),
                },
            );
            Ok(())
        }));
        webview
            .PrintToPdf(&HSTRING::from(path), &settings, &handler)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn start(pw: tauri::webview::PlatformWebview, path: &str, paper: &str, done: Done) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2::msg_send;
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    let (w, h) = paper_inches(paper);
    unsafe {
        let webview: &WKWebView = &*(pw.inner() as *const WKWebView);
        let window: &NSWindow = &*(pw.ns_window() as *const NSWindow);

        // Copia del NSPrintInfo compartido: no tocar los ajustes de «Imprimir…».
        let info: Retained<NSPrintInfo> = msg_send![&*NSPrintInfo::sharedPrintInfo(), copy];
        info.setPaperSize(NSSize::new(w * 72.0, h * 72.0));
        info.setTopMargin(0.0);
        info.setBottomMargin(0.0);
        info.setLeftMargin(0.0);
        info.setRightMargin(0.0);
        info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        info.setJobDisposition(NSPrintSaveJob);
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let dict = info.dictionary();
        let () = msg_send![&*dict, setObject: &*url, forKey: NSPrintJobSavingURL];

        let op = webview.printOperationWithPrintInfo(&info);
        op.setShowsPrintPanel(false);
        op.setShowsProgressPanel(false);
        // Sin esto WKWebView imprime hojas en blanco.
        if let Some(view) = op.view() {
            view.setFrame(webview.bounds());
        }
        op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            None,
            None,
            std::ptr::null_mut(),
        );
    }
    // La operación es asíncrona y sin delegado; save_pdf espera al archivo.
    finish(&done, Ok(()));
    Ok(())
}
