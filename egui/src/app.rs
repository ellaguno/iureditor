//! La ventana: barra con las acciones del archivo, pestañas y el editor de documentos de la suite.
//!
//! Cada documento abierto es una pestaña con su propio editor (cursor y deshacer), su borrador de
//! recuperación y su vigilancia de cambios en disco. Ctrl+T / Ctrl+N abren una pestaña, Ctrl+W la
//! cierra (pregunta si hay cambios), Ctrl+Tab / Ctrl+Mayús+Tab (o Ctrl+AvPág / Ctrl+RePág) pasan
//! de una a otra. Al cerrar la ventana se recorren las pestañas con cambios y se guarda la sesión,
//! que se restaura al abrir sin archivo (como la versión Tauri).

use std::path::PathBuf;
use std::sync::mpsc;

use egui::{Key, KeyboardShortcut, Modifiers};
use iurefficient_ui::lang::pick;

use crate::doc::Doc;

/// Qué se hará cuando se resuelva «¿guardar los cambios?».
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Then {
    /// Cerrar la pestaña activa.
    CloseTab,
    /// Cerrar la ventana (pestaña por pestaña).
    Close,
}

/// Respuesta de un diálogo de archivo (corre en otro hilo: la ventana no se congela).
enum Picked {
    Open(Option<PathBuf>),
    /// Guardar como: la pestaña (por su identidad) y qué hacer después.
    SaveAs(Option<PathBuf>, u64, Option<Then>),
    /// Exportar: destino, formato y pestaña.
    Export(Option<PathBuf>, crate::export::Format, u64),
}

/// Una pestaña: su documento y lo que se lleva de él.
pub(crate) struct Tab {
    pub(crate) doc: Doc,
    /// Identidad: el estado del editor (cursor, deshacer) y el borrador son por pestaña.
    id: u64,
    /// Huella del texto y cuándo cambió por última vez (segundos de egui).
    seen: (u64, f64),
    /// Huella del último borrador escrito (0: ninguno).
    drafted: u64,
    /// Generación de borradores: un borrador que tarda no reaparece tras guardar o descartar.
    draft_gen: std::sync::Arc<std::sync::Mutex<u64>>,
}

impl Tab {
    fn new(doc: Doc, id: u64) -> Tab {
        Tab { doc, id, seen: (0, 0.0), drafted: 0, draft_gen: std::sync::Arc::new(std::sync::Mutex::new(0)) }
    }

    /// Nombre para la pestaña («• » con cambios sin guardar).
    fn label(&self) -> String {
        let name = self
            .doc
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| pick("Untitled", "Sin título").to_string(), |n| n.to_string_lossy().into_owned());
        if self.doc.dirty() { format!("• {name}") } else { name }
    }

    /// Una pestaña nueva, sin archivo, vacía y sin cambios.
    fn pristine(&self) -> bool {
        self.doc.path.is_none() && self.doc.text.is_empty() && !self.doc.dirty()
    }
}

pub struct EditorApp {
    pub(crate) tabs: Vec<Tab>,
    pub(crate) active: usize,
    next_id: u64,
    notice: Option<String>,
    /// Aviso de que algo salió bien (exportado…).
    info: Option<String>,
    picker: Option<mpsc::Receiver<Picked>>,
    /// Exportación en curso (dibuja diagramas en otro hilo): el archivo o el error.
    exporting: Option<mpsc::Receiver<Result<PathBuf, String>>>,
    /// «¿Guardar los cambios?» pendiente (sobre la pestaña activa).
    ask: Option<Then>,
    /// Cerrar sin volver a preguntar.
    closing: bool,
    /// Última vez que se miró si otro programa cambió los archivos.
    disk_check: f64,
    title: String,
    themed: bool,
    /// Corrector ortográfico (diccionarios del sistema, español e inglés; uno para la app).
    speller: std::sync::Arc<iure_doc_ui::Speller>,
    /// Borradores de recuperación (carpeta; `None`: sin carpeta de datos).
    drafts: Option<PathBuf>,
    /// Archivo de la sesión (`None` en las pruebas).
    session: Option<PathBuf>,
    /// Borradores de un cierre inesperado, para ofrecer recuperarlos (el más reciente primero).
    pub(crate) recovery: Vec<(PathBuf, crate::drafts::Draft)>,
}

/// Espera tras el último cambio antes de escribir el borrador (como IureEditor Tauri).
const DRAFT_DELAY: f64 = 2.5;
/// Pestañas abiertas como mucho.
const MAX_TABS: usize = 64;

fn hash_text(t: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    t.hash(&mut h);
    h.finish() | 1
}

const SAVE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::S);
const SAVE_AS: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::S);
const OPEN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::O);
const NEW: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::N);
const NEW_TAB: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::T);
const CLOSE_TAB: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::W);

impl EditorApp {
    #[cfg(test)]
    pub fn new(doc: Doc, notice: Option<String>) -> Self {
        Self::with_docs(vec![doc], 0, notice)
    }

    /// Con varios documentos abiertos (uno por pestaña) y el activo.
    pub fn with_docs(docs: Vec<Doc>, active: usize, notice: Option<String>) -> Self {
        let mut tabs: Vec<Tab> =
            docs.into_iter().take(MAX_TABS).enumerate().map(|(i, d)| Tab::new(d, i as u64 + 1)).collect();
        if tabs.is_empty() {
            tabs.push(Tab::new(Doc::default(), 1));
        }
        let next_id = tabs.len() as u64 + 1;
        let active = active.min(tabs.len().saturating_sub(1));
        EditorApp {
            tabs,
            active,
            next_id,
            notice,
            info: None,
            picker: None,
            exporting: None,
            ask: None,
            closing: false,
            disk_check: 0.0,
            title: String::new(),
            themed: false,
            speller: iure_doc_ui::Speller::system(iure_doc_ui::spell::personal_path("iureditor")),
            // En las pruebas no se tocan los borradores ni la sesión del usuario.
            drafts: if cfg!(test) { None } else { crate::drafts::drafts_dir() },
            session: if cfg!(test) { None } else { crate::drafts::session_file() },
            recovery: Vec::new(),
        }
    }

    /// El documento de la pestaña activa.
    pub(crate) fn doc(&self) -> &Doc {
        // Siempre hay al menos una pestaña; por si acaso, un documento vacío.
        static EMPTY: std::sync::OnceLock<Doc> = std::sync::OnceLock::new();
        self.tabs.get(self.active).or(self.tabs.first()).map_or_else(|| EMPTY.get_or_init(Doc::default), |t| &t.doc)
    }

    fn tab_mut(&mut self) -> Option<&mut Tab> {
        let i = self.active;
        self.tabs.get_mut(i)
    }

    fn new_id(&mut self) -> u64 {
        self.next_id = self.next_id.wrapping_add(1);
        self.next_id
    }

    /// Abre `doc` en una pestaña nueva (o en la activa si es nueva y está vacía).
    fn push_tab(&mut self, doc: Doc) {
        let id = self.new_id();
        if self.tabs.get(self.active).is_some_and(Tab::pristine) {
            if let Some(t) = self.tab_mut() {
                *t = Tab::new(doc, id);
            }
            return;
        }
        if self.tabs.len() >= MAX_TABS {
            self.notice = Some(pick("Too many open tabs.", "Hay demasiadas pestañas abiertas.").to_string());
            return;
        }
        self.tabs.push(Tab::new(doc, id));
        self.active = self.tabs.len() - 1;
    }

    /// Abre un archivo: si ya está abierto, pasa a su pestaña.
    fn open_path(&mut self, path: &std::path::Path) {
        let canon = path.canonicalize().ok();
        if let Some(i) = self.tabs.iter().position(|t| {
            t.doc.path.as_ref().is_some_and(|p| p == path || (canon.is_some() && p.canonicalize().ok() == canon))
        }) {
            self.active = i;
            return;
        }
        match Doc::open(path) {
            Ok(d) => self.push_tab(d),
            Err(e) => self.notice = Some(e.human(path)),
        }
    }

    fn open_dialog(&mut self) {
        let (tx, rx) = mpsc::channel();
        let dir = self.doc().path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        std::thread::spawn(move || {
            let mut d = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown", "txt"]);
            if let Some(dir) = dir {
                d = d.set_directory(dir);
            }
            let _ = tx.send(Picked::Open(d.pick_file()));
        });
        self.picker = Some(rx);
    }

    fn save_as_dialog(&mut self, then: Option<Then>) {
        let (tx, rx) = mpsc::channel();
        let name = self
            .doc()
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| format!("{}.md", pick("document", "documento")), |n| n.to_string_lossy().into_owned());
        let id = self.tabs.get(self.active).map_or(0, |t| t.id);
        std::thread::spawn(move || {
            let d = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown", "txt"]).set_file_name(name);
            let _ = tx.send(Picked::SaveAs(d.save_file(), id, then));
        });
        self.picker = Some(rx);
    }

    fn export_dialog(&mut self, format: crate::export::Format) {
        let (tx, rx) = mpsc::channel();
        let path = self.doc().path.clone();
        let stem = path
            .as_ref()
            .and_then(|p| p.file_stem())
            .map_or_else(|| pick("document", "documento").to_string(), |n| n.to_string_lossy().into_owned());
        let dir = path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        let id = self.tabs.get(self.active).map_or(0, |t| t.id);
        std::thread::spawn(move || {
            let mut d = rfd::FileDialog::new()
                .add_filter(format.filter(), &[format.ext()])
                .set_file_name(format!("{stem}.{}", format.ext()));
            if let Some(dir) = dir {
                d = d.set_directory(dir);
            }
            let _ = tx.send(Picked::Export(d.save_file(), format, id));
        });
        self.picker = Some(rx);
    }

    /// Exporta la pestaña `id` a `out` en otro hilo (los diagramas tardan en dibujarse).
    fn start_export(&mut self, ctx: &egui::Context, out: PathBuf, format: crate::export::Format, id: u64) {
        let Some(t) = self.tabs.iter().find(|t| t.id == id) else { return };
        let text = t.doc.text.clone();
        let base = t.doc.path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        let (tx, rx) = mpsc::channel();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let r = crate::export::export(&text, base, format, &out).map(|()| out);
            let _ = tx.send(r);
            ctx.request_repaint();
        });
        self.info = Some(pick("Exporting…", "Exportando…").to_string());
        self.exporting = Some(rx);
    }

    fn poll_export(&mut self) {
        let Some(rx) = &self.exporting else { return };
        let r = match rx.try_recv() {
            Ok(r) => r,
            Err(mpsc::TryRecvError::Empty) => return,
            Err(mpsc::TryRecvError::Disconnected) => {
                Err(pick("The export was interrupted.", "La exportación se interrumpió.").to_string())
            }
        };
        self.exporting = None;
        match r {
            Ok(p) => {
                let name = p.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
                self.info = Some(format!("{} «{name}».", pick("Exported to", "Exportado a")));
            }
            Err(e) => {
                self.info = None;
                self.notice = Some(e);
            }
        }
    }

    /// Guarda la pestaña activa; sin archivo, pregunta dónde. `true` si quedó guardado.
    fn save(&mut self, then: Option<Then>) -> bool {
        if self.doc().path.is_none() {
            self.save_as_dialog(then);
            return false;
        }
        let Some(t) = self.tab_mut() else { return false };
        match t.doc.save(None) {
            Ok(()) => true,
            Err(e) => {
                let p = t.doc.path.clone().unwrap_or_default();
                self.notice = Some(e.human(&p));
                false
            }
        }
    }

    fn act(&mut self, ctx: &egui::Context, then: Then) {
        if then == Then::CloseTab && self.doc().dirty() {
            self.ask = Some(then);
            return;
        }
        self.run(ctx, then);
    }

    fn run(&mut self, ctx: &egui::Context, then: Then) {
        match then {
            Then::CloseTab => {
                let i = self.active;
                self.clear_draft(i);
                if i < self.tabs.len() {
                    self.tabs.remove(i);
                }
                if self.tabs.is_empty() {
                    let id = self.new_id();
                    self.tabs.push(Tab::new(Doc::default(), id));
                }
                self.active = i.min(self.tabs.len().saturating_sub(1));
            }
            Then::Close => {
                // Pestaña por pestaña: la siguiente con cambios pregunta.
                if let Some(i) = self.tabs.iter().position(|t| t.doc.dirty()) {
                    self.active = i;
                    self.ask = Some(Then::Close);
                    return;
                }
                self.closing = true;
                if let Some(f) = &self.session {
                    let paths: Vec<PathBuf> = self.tabs.iter().filter_map(|t| t.doc.path.clone()).collect();
                    let active = self.tabs.iter().take(self.active).filter(|t| t.doc.path.is_some()).count();
                    crate::drafts::save_session(f, &paths, active);
                }
                for i in 0..self.tabs.len() {
                    self.clear_draft(i);
                }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }

    /// Usa otra carpeta de borradores (pruebas).
    #[cfg(test)]
    pub(crate) fn set_drafts_dir(&mut self, dir: PathBuf) {
        self.drafts = Some(dir);
    }

    /// Usa otro archivo de sesión (pruebas).
    #[cfg(test)]
    pub(crate) fn set_session_file(&mut self, f: PathBuf) {
        self.session = Some(f);
    }

    /// Borra el borrador de la pestaña `i` (y anula uno que se esté escribiendo).
    fn clear_draft(&mut self, i: usize) {
        let Some(dir) = self.drafts.clone() else { return };
        let Some(t) = self.tabs.get_mut(i) else { return };
        let mut g = t.draft_gen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        *g = g.wrapping_add(1);
        crate::drafts::clear(&dir, t.id);
        drop(g);
        t.drafted = 0;
    }

    /// En cada pestaña con cambios sin guardar escribe su borrador 2,5 s después del último
    /// cambio (en otro hilo); sin cambios, lo borra.
    fn draft_tick(&mut self, ctx: &egui::Context) {
        let Some(dir) = self.drafts.clone() else { return };
        let now = ctx.input(|i| i.time);
        for i in 0..self.tabs.len() {
            let Some(t) = self.tabs.get_mut(i) else { continue };
            let h = hash_text(&t.doc.text);
            if h != t.seen.0 {
                t.seen = (h, now);
            }
            if !t.doc.dirty() {
                if t.drafted != 0 {
                    self.clear_draft(i);
                }
                continue;
            }
            if t.drafted == h {
                continue;
            }
            let wait = DRAFT_DELAY - (now - t.seen.1);
            if wait > 0.0 {
                ctx.request_repaint_after(std::time::Duration::from_secs_f64(wait));
                continue;
            }
            t.drafted = h;
            let gen_lock = std::sync::Arc::clone(&t.draft_gen);
            let my_gen = *gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (dir, tab, path, text) = (dir.clone(), t.id, t.doc.path.clone(), t.doc.text.clone());
            std::thread::spawn(move || {
                let g = gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                if *g == my_gen {
                    let _ = crate::drafts::write(&dir, tab, path.as_deref(), &text);
                }
            });
        }
    }

    /// «¿Recuperar lo que no se guardó?» tras un cierre inesperado: cada borrador en su pestaña.
    fn recovery_window(&mut self, ctx: &egui::Context) {
        let Some((_, newest)) = self.recovery.first().cloned() else { return };
        let name_of = |d: &crate::drafts::Draft| {
            d.path
                .as_ref()
                .and_then(|p| p.file_name())
                .map_or_else(|| pick("Untitled", "Sin título").to_string(), |n| n.to_string_lossy().into_owned())
        };
        let names: Vec<String> = self.recovery.iter().take(6).map(|(_, d)| format!("«{}»", name_of(d))).collect();
        let more = self.recovery.len().saturating_sub(6);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let mins = now.saturating_sub(newest.saved_at) / 60;
        let when = match mins {
            0 => pick("less than a minute ago", "hace menos de un minuto").to_string(),
            m if m < 120 => format!("{} {m} min", pick("about", "hace")),
            m => format!("{} {} h", pick("about", "hace"), m / 60),
        };
        let mut answer: Option<bool> = None;
        egui::Window::new(pick("Recover unsaved changes?", "¿Recuperar lo que no se guardó?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(format!(
                    "{} {} ({when}).",
                    pick(
                        "IureEditor closed unexpectedly with unsaved changes in",
                        "IureEditor se cerró sin guardar los cambios de"
                    ),
                    names.join(", ")
                ));
                if more > 0 {
                    ui.weak(format!("{} {more}", pick("and more:", "y otros:")));
                }
                ui.horizontal(|ui| {
                    if ui.button(pick("Recover", "Recuperar")).clicked() {
                        answer = Some(true);
                    }
                    if ui.button(pick("Discard", "Descartar")).clicked() {
                        answer = Some(false);
                    }
                });
            });
        match answer {
            Some(true) => {
                // Cada documento con el texto del borrador encima (queda con cambios sin guardar).
                let drafts = std::mem::take(&mut self.recovery);
                for (file, draft) in drafts.into_iter().rev() {
                    let mut doc = match &draft.path {
                        Some(p) if p.is_file() => {
                            Doc::open(p).unwrap_or_else(|_| Doc { path: Some(p.clone()), ..Default::default() })
                        }
                        Some(p) => Doc { path: Some(p.clone()), ..Default::default() },
                        None => Doc::default(),
                    };
                    doc.text = draft.text;
                    // Si ese documento ya está abierto (sin cambios), el borrador va en su pestaña.
                    match self
                        .tabs
                        .iter()
                        .position(|t| t.doc.path.is_some() && t.doc.path == doc.path && !t.doc.dirty())
                    {
                        Some(i) => {
                            if let Some(t) = self.tabs.get_mut(i) {
                                t.doc.text = doc.text;
                            }
                            self.active = i;
                        }
                        None => self.push_tab(doc),
                    }
                    crate::drafts::remove(&[file]);
                }
            }
            Some(false) => {
                let files: Vec<PathBuf> = self.recovery.drain(..).map(|(f, _)| f).collect();
                crate::drafts::remove(&files);
            }
            None => {}
        }
    }

    fn poll_picker(&mut self, ctx: &egui::Context) {
        let Some(rx) = &self.picker else { return };
        let Ok(p) = rx.try_recv() else {
            ctx.request_repaint_after(std::time::Duration::from_millis(200));
            return;
        };
        self.picker = None;
        match p {
            Picked::Open(Some(path)) => self.open_path(&path),
            Picked::SaveAs(Some(path), id, then) => {
                let Some(i) = self.tabs.iter().position(|t| t.id == id) else { return };
                let Some(t) = self.tabs.get_mut(i) else { return };
                match t.doc.save(Some(&path)) {
                    Ok(()) => {
                        if let Some(then) = then {
                            self.active = i;
                            self.run(ctx, then);
                        }
                    }
                    Err(e) => self.notice = Some(e.human(&path)),
                }
            }
            Picked::Export(Some(path), format, id) => self.start_export(ctx, path, format, id),
            Picked::Open(None) | Picked::SaveAs(None, _, _) | Picked::Export(None, _, _) => {}
        }
    }

    /// Si otro programa cambió un archivo: sin cambios propios se vuelve a leer; con cambios, se
    /// avisa (no se pisa nada).
    fn check_disk(&mut self, now: f64) {
        if now - self.disk_check < 2.0 {
            return;
        }
        self.disk_check = now;
        for i in 0..self.tabs.len() {
            let Some(t) = self.tabs.get(i) else { continue };
            if !t.doc.changed_on_disk() {
                continue;
            }
            let Some(path) = t.doc.path.clone() else { continue };
            if t.doc.dirty() {
                let name = path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
                self.notice = Some(format!(
                    "«{name}»: {}",
                    pick(
                        "another program changed this file; saving will replace its version.",
                        "otro programa cambió este archivo; al guardar se reemplaza su versión.",
                    )
                ));
                if let Some(t) = self.tabs.get_mut(i) {
                    t.doc.mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
                }
            } else if let Ok(d) = Doc::open(&path) {
                let id = self.new_id();
                if let Some(t) = self.tabs.get_mut(i) {
                    // Estado de editor nuevo para el texto nuevo.
                    *t = Tab::new(d, id);
                }
            }
        }
    }

    fn bar(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        ui.horizontal(|ui| {
            if ui.button(pick("New", "Nuevo")).on_hover_text(ctx.format_shortcut(&NEW)).clicked() {
                self.push_tab(Doc::default());
            }
            if ui.button(pick("Open…", "Abrir…")).on_hover_text(ctx.format_shortcut(&OPEN)).clicked() {
                self.open_dialog();
            }
            if ui.button(pick("Save", "Guardar")).on_hover_text(ctx.format_shortcut(&SAVE)).clicked() {
                self.save(None);
            }
            if ui.button(pick("Save as…", "Guardar como…")).on_hover_text(ctx.format_shortcut(&SAVE_AS)).clicked() {
                self.save_as_dialog(None);
            }
            ui.add_enabled_ui(self.exporting.is_none(), |ui| {
                ui.menu_button(pick("Export", "Exportar"), |ui| {
                    if ui.button(pick("Web page (HTML)…", "Página web (HTML)…")).clicked() {
                        self.export_dialog(crate::export::Format::Html);
                        ui.close();
                    }
                    if ui.button(pick("Word (DOCX)…", "Word (DOCX)…")).clicked() {
                        self.export_dialog(crate::export::Format::Docx);
                        ui.close();
                    }
                    if ui.button("PDF…").clicked() {
                        self.export_dialog(crate::export::Format::Pdf);
                        ui.close();
                    }
                });
            });
            ui.separator();
            let state = if self.doc().dirty() {
                pick("Unsaved changes", "Cambios sin guardar")
            } else {
                pick("Saved", "Guardado")
            };
            ui.weak(state);
        });
        if let Some(n) = self.info.clone() {
            ui.horizontal(|ui| {
                ui.label(n);
                if self.exporting.is_none() && ui.small_button(pick("Close", "Cerrar")).clicked() {
                    self.info = None;
                }
            });
        }
        if let Some(n) = self.notice.clone() {
            ui.horizontal(|ui| {
                ui.colored_label(iurefficient_ui::theme::colors(ui).danger, n);
                if ui.small_button(pick("Close", "Cerrar")).clicked() {
                    self.notice = None;
                }
            });
        }
        self.tab_bar(ui);
    }

    /// Las pestañas: un clic cambia, «×» (o el botón del medio) cierra.
    fn tab_bar(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let mut select = None;
        let mut close = None;
        egui::ScrollArea::horizontal().id_salt("iureditor-tabs").auto_shrink([false, true]).show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (i, t) in self.tabs.iter().enumerate() {
                    let label = t.label();
                    let r = ui
                        .selectable_label(i == self.active, &label)
                        .on_hover_text(t.doc.path.as_ref().map_or_else(|| label.clone(), |p| p.display().to_string()));
                    if r.clicked() {
                        select = Some(i);
                    }
                    if r.middle_clicked() {
                        close = Some(i);
                    }
                    let x = ui.small_button("×").on_hover_text(ctx.format_shortcut(&CLOSE_TAB));
                    let name = format!("{} {label}", pick("Close", "Cerrar"));
                    x.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, name.clone()));
                    if x.clicked() {
                        close = Some(i);
                    }
                    ui.add_space(6.0);
                }
                if ui.small_button("+").on_hover_text(ctx.format_shortcut(&NEW_TAB)).clicked() {
                    self.push_tab(Doc::default());
                }
            });
        });
        if let Some(i) = select {
            self.active = i;
        }
        if let Some(i) = close {
            self.active = i;
            self.act(&ctx, Then::CloseTab);
        }
    }

    fn ask_window(&mut self, ctx: &egui::Context) {
        let Some(then) = self.ask else { return };
        let name = self.tabs.get(self.active).map(Tab::label).unwrap_or_default();
        let name = name.trim_start_matches("• ").to_string();
        let mut answer: Option<Option<bool>> = None;
        egui::Window::new(pick("Save changes?", "¿Guardar los cambios?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(format!("«{name}» {}", pick("has changes that are not saved.", "tiene cambios sin guardar.")));
                ui.horizontal(|ui| {
                    if ui.button(pick("Save", "Guardar")).clicked() {
                        answer = Some(Some(true));
                    }
                    if ui.button(pick("Don't save", "No guardar")).clicked() {
                        answer = Some(Some(false));
                    }
                    if ui.button(pick("Cancel", "Cancelar")).clicked() || ui.input(|i| i.key_pressed(Key::Escape)) {
                        answer = Some(None);
                    }
                });
            });
        match answer {
            Some(Some(true)) => {
                self.ask = None;
                if self.save(Some(then)) {
                    self.run(ctx, then);
                }
            }
            Some(Some(false)) => {
                self.ask = None;
                if let Some(t) = self.tab_mut() {
                    t.doc.saved = t.doc.text.clone();
                }
                // «No guardar»: sin borrador huérfano.
                let i = self.active;
                self.clear_draft(i);
                self.run(ctx, then);
            }
            Some(None) => self.ask = None,
            None => {}
        }
    }

    /// Atajos de las pestañas (antes que el editor).
    fn tab_keys(&mut self, ctx: &egui::Context) {
        let n = self.tabs.len();
        let (new, close, next, prev) = ctx.input_mut(|i| {
            let new = i.consume_shortcut(&NEW_TAB) || i.consume_shortcut(&NEW);
            let close = i.consume_shortcut(&CLOSE_TAB);
            let shift_cmd = Modifiers { shift: true, ..Modifiers::COMMAND };
            let prev = i.consume_key(shift_cmd, Key::Tab) || i.consume_key(Modifiers::COMMAND, Key::PageUp);
            let next = (!prev && i.consume_key(Modifiers::COMMAND, Key::Tab))
                || i.consume_key(Modifiers::COMMAND, Key::PageDown);
            (new, close, next, prev)
        });
        if new {
            self.push_tab(Doc::default());
        }
        if close {
            self.act(ctx, Then::CloseTab);
        }
        if next && n > 0 {
            self.active = (self.active + 1) % n;
        }
        if prev && n > 0 {
            self.active = (self.active + n - 1) % n;
        }
    }

    /// Un cuadro de la ventana.
    pub fn ui(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        if !self.themed {
            self.themed = true;
            // La tipografía de la suite (Inter con sus pesos: los títulos y la negrita se ven).
            iurefficient_ui::fonts::install_choice(&ctx, &iurefficient_ui::fonts::FontChoice::Bundled);
            iurefficient_ui::theme::apply(&ctx, iurefficient_ui::theme::ThemeMode::System, Default::default());
            iurefficient_ui::system::watch_system_theme(&ctx);
        }
        iurefficient_ui::theme::refresh(&ctx);
        // Cerrar la ventana: pestaña por pestaña las que tienen cambios; luego, la sesión.
        if ctx.input(|i| i.viewport().close_requested()) && !self.closing {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.run(&ctx, Then::Close);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE_AS)) {
            self.save_as_dialog(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE)) {
            self.save(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&OPEN)) {
            self.open_dialog();
        }
        self.tab_keys(&ctx);
        self.poll_picker(&ctx);
        self.poll_export();
        self.draft_tick(&ctx);
        self.check_disk(ctx.input(|i| i.time));
        let title = self.doc().title();
        if title != self.title {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(title.clone()));
            self.title = title;
        }
        egui::Panel::top("iureditor-bar").show(ui, |ui| self.bar(ui));
        egui::CentralPanel::default().show(ui, |ui| {
            // Ancho cómodo de lectura, centrado.
            let w = ui.available_width().min(860.0);
            let pad = ((ui.available_width() - w) / 2.0).max(0.0);
            ui.horizontal_top(|ui| {
                ui.add_space(pad);
                ui.vertical(|ui| {
                    ui.set_width(w);
                    let speller = self.speller.clone();
                    let Some(t) = self.tabs.get_mut(self.active) else { return };
                    // Diagramas (Mermaid, mapas mentales) e imágenes de la carpeta del documento,
                    // dibujados en su lugar.
                    let folder = t.doc.path.as_ref().and_then(|p| p.parent()).map(std::path::Path::to_path_buf);
                    let diagrams: std::sync::Arc<dyn iure_doc_ui::DiagramRenderer> =
                        std::sync::Arc::new(iure_doc_ui::Renderers(vec![
                            std::sync::Arc::new(crate::diagrams::Diagrams::new(ui)),
                            std::sync::Arc::new(iure_doc_ui::LocalImages::new(folder.clone())),
                        ]));
                    // Pegar de la web, Word o Google Docs pega su Markdown (el HTML del portapapeles).
                    let hooks = iure_doc_ui::Hooks {
                        diagrams: Some(diagrams),
                        paste: Some(std::sync::Arc::new(iure_doc_ui::SystemClipboard)),
                        spell: Some(speller),
                        // Imágenes pegadas o soltadas: en `assets/` junto al documento (como la
                        // versión Tauri).
                        images: Some(std::sync::Arc::new(iure_doc_ui::FolderImages::new(folder, "assets"))),
                    };
                    let out = iure_doc_ui::show_blocks_hooks(
                        ui,
                        egui::Id::unique(("iureditor-doc", t.id)),
                        &mut t.doc.text,
                        pick(
                            "Write here… (# title, - list, **bold**)",
                            "Escribe aquí… (# título, - lista, **negrita**)",
                        ),
                        hooks,
                    );
                    out.response.widget_info(|| {
                        egui::WidgetInfo::labeled(egui::Role::MultilineTextInput, true, pick("Document", "Documento"))
                    });
                });
            });
        });
        self.ask_window(&ctx);
        self.recovery_window(&ctx);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::Harness;
    use egui_kittest::kittest::Queryable;

    #[test]
    fn typing_marks_the_document_unsaved_and_ctrl_s_saves() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "# Título\n\nTexto\n").unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text("¡");
        h.run();
        assert!(h.state().doc().dirty());
        assert!(h.state().title.starts_with("• "));
        h.key_press_modifiers(Modifiers::COMMAND, Key::S);
        h.run();
        assert!(!h.state().doc().dirty());
        // Al enfocar, el cursor queda al final del primer bloque.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Título¡\n\nTexto\n");
    }

    #[test]
    fn new_opens_a_tab_and_closing_a_changed_tab_asks() {
        let d = Doc { text: "borrador".into(), ..Default::default() };
        let app = EditorApp::new(d, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        // «Nuevo»: otra pestaña; el borrador sigue en la suya.
        h.get_by_label("Nuevo").click();
        h.run();
        assert_eq!(h.state().tabs.len(), 2);
        assert!(h.state().doc().text.is_empty());
        // Volver a la pestaña con cambios y cerrarla: pregunta.
        h.get_by_label("• Sin título").click();
        h.run();
        assert_eq!(h.state().doc().text, "borrador");
        h.key_press_modifiers(Modifiers::COMMAND, Key::W);
        h.run();
        assert_eq!(h.state().ask, Some(Then::CloseTab));
        h.get_by_label("No guardar").click();
        h.run();
        assert_eq!(h.state().tabs.len(), 1);
        assert!(h.state().doc().text.is_empty() && h.state().ask.is_none());
    }
}

#[cfg(test)]
mod diagram_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    #[test]
    fn mermaid_blocks_are_drawn_in_place() {
        let text = "Plan\n\n```mermaid\ngraph LR; A --> B\n```\n";
        let doc = Doc { saved: text.into(), text: text.into(), ..Default::default() };
        let app = EditorApp::new(doc, None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        // El dibujo llega de otro hilo (Blitz).
        let mut seen = false;
        for _ in 0..600 {
            h.step();
            if h.query_by_label("Diagrama 2").is_some() {
                seen = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(seen, "el diagrama se ve dibujado");
        assert_eq!(h.state().doc().text, text, "dibujarlo no cambia el documento");
    }

    #[test]
    fn images_next_to_the_document_are_shown_in_place() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("img")).unwrap();
        image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 90, 180, 255]))
            .save(dir.path().join("img/punto.png"))
            .unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "![Punto azul](img/punto.png)\n").unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        let mut seen = false;
        for _ in 0..300 {
            h.step();
            if h.query_by_label("Imagen 1: Punto azul").is_some() {
                seen = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(seen, "la imagen junto al documento se ve en su lugar");
    }
}

#[cfg(test)]
mod tab_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    fn harness(app: EditorApp) -> egui_kittest::Harness<'static, EditorApp> {
        egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app)
    }

    fn file(dir: &std::path::Path, name: &str, text: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn shortcuts_switch_tabs_and_an_open_file_is_not_opened_twice() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "A\n"), file(dir.path(), "b.md", "B\n"));
        let mut app = EditorApp::new(Doc::default(), None);
        // La pestaña nueva y vacía se reutiliza al abrir.
        app.open_path(&a);
        assert_eq!(app.tabs.len(), 1);
        app.open_path(&b);
        assert_eq!((app.tabs.len(), app.active), (2, 1));
        app.open_path(&a);
        assert_eq!((app.tabs.len(), app.active), (2, 0), "ya abierto: pasa a su pestaña");
        let mut h = harness(app);
        h.run();
        h.key_press_modifiers(Modifiers::COMMAND, Key::Tab);
        h.run();
        assert_eq!(h.state().active, 1);
        h.key_press_modifiers(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::Tab);
        h.run();
        assert_eq!(h.state().active, 0);
        h.key_press_modifiers(Modifiers::COMMAND, Key::T);
        h.run();
        assert_eq!((h.state().tabs.len(), h.state().active), (3, 2));
        assert!(h.query_by_label("b.md").is_some() && h.query_by_label("Sin título").is_some());
    }

    #[test]
    fn each_tab_keeps_its_own_text_and_undo() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "Uno\n"), file(dir.path(), "b.md", "Dos\n"));
        let app = EditorApp::with_docs(vec![Doc::open(&a).unwrap(), Doc::open(&b).unwrap()], 0, None);
        let mut h = harness(app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text(" más");
        h.run_steps(2);
        h.get_by_label("b.md").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Dos\n");
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text("!");
        h.run_steps(2);
        h.get_by_label("• a.md").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Uno más\n");
        h.get_by_label("Documento").focus();
        h.run();
        h.key_press_modifiers(Modifiers::COMMAND, Key::Z);
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Uno\n", "deshacer solo en su pestaña");
        assert_eq!(h.state().tabs.get(1).map(|t| t.doc.text.as_str()), Some("Dos!\n"));
    }

    #[test]
    fn closing_the_window_asks_tab_by_tab_and_saves_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "A\n"), file(dir.path(), "b.md", "B\n"));
        let mut da = Doc::open(&a).unwrap();
        da.text.push('x');
        let mut db = Doc::open(&b).unwrap();
        db.text.push('y');
        let mut app = EditorApp::with_docs(vec![da, db, Doc::default()], 2, None);
        let session = dir.path().join("datos/sesion.json");
        app.set_session_file(session.clone());
        let mut h = harness(app);
        h.run();
        let ctx = h.ctx.clone();
        h.state_mut().run(&ctx, Then::Close);
        h.run();
        assert!(h.query_by_label_contains("«a.md» tiene cambios").is_some(), "la primera con cambios");
        h.get_by_label("No guardar").click();
        h.run();
        assert!(h.query_by_label_contains("«b.md» tiene cambios").is_some(), "luego la siguiente");
        // El «Guardar» de la pregunta (el otro es el de la barra).
        h.get_all_by_label("Guardar").last().unwrap().click();
        h.run_steps(2);
        assert!(h.state().closing);
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "B\ny", "la segunda se guardó");
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "A\n", "la primera, no");
        // La sesión: los documentos con archivo y la última pestaña que se vio (b.md).
        assert_eq!(crate::drafts::load_session(&session), (vec![a, b], 1));
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[derive(Debug)]
    struct Dropped(PathBuf);

    impl egui::DroppedFile for Dropped {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
        fn bytes(&self) -> Result<Vec<u8>, String> {
            std::fs::read(&self.0).map_err(|e| e.to_string())
        }
    }

    #[test]
    fn dropped_images_go_to_assets_next_to_the_document() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "Texto\n").unwrap();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("logo.png");
        image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255])).save(&src).unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run_steps(2);
        h.input_mut().dropped_files.push(std::sync::Arc::new(Dropped(src)));
        h.run_steps(4);
        assert_eq!(h.state().doc().text, "Texto\n\n![logo](assets/logo.png)\n");
        assert!(dir.path().join("assets/logo.png").is_file());
    }
}

#[cfg(test)]
mod draft_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    fn harness(app: EditorApp) -> egui_kittest::Harness<'static, EditorApp> {
        egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app)
    }

    /// El borrador de la primera pestaña de esta ventana.
    fn my_draft(dir: &std::path::Path) -> PathBuf {
        dir.join(format!("{}-1.json", std::process::id()))
    }

    /// Espera a que un archivo exista (o no) — lo escribe otro hilo.
    fn wait_file(p: &std::path::Path, exists: bool) -> bool {
        for _ in 0..200 {
            if p.exists() == exists {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn unsaved_changes_leave_a_draft_until_saved() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "Texto\n").unwrap();
        let mut app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let drafts = dir.path().join("borradores");
        app.set_drafts_dir(drafts.clone());
        let mut h = harness(app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text(" nuevo");
        // Antes de 2,5 s, nada; después (cada paso son 0,25 s), el borrador.
        h.run_steps(4);
        assert!(!my_draft(&drafts).exists());
        h.run_steps(8);
        assert!(wait_file(&my_draft(&drafts), true), "borrador escrito");
        let d = crate::drafts::orphans(&drafts);
        assert!(d.iter().any(|(_, x)| x.text.contains("nuevo") && x.path.as_deref() == Some(p.as_path())));
        h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::S);
        h.run_steps(2);
        assert!(wait_file(&my_draft(&drafts), false), "al guardar se borra");
    }

    #[test]
    fn dont_save_removes_the_draft() {
        let dir = tempfile::tempdir().unwrap();
        let drafts = dir.path().join("borradores");
        let mut app = EditorApp::new(Doc { text: "borrador".into(), ..Default::default() }, None);
        app.set_drafts_dir(drafts.clone());
        let mut h = harness(app);
        h.run_steps(12);
        assert!(wait_file(&my_draft(&drafts), true));
        h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::W);
        h.run();
        h.get_by_label("No guardar").click();
        h.run_steps(2);
        assert!(wait_file(&my_draft(&drafts), false));
    }

    #[test]
    fn a_draft_from_a_crash_can_be_recovered() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("contrato.md");
        std::fs::write(&p, "Versión guardada\n").unwrap();
        let drafts = dir.path().join("borradores");
        std::fs::create_dir_all(&drafts).unwrap();
        let orphan = drafts.join("4000000.json");
        std::fs::write(
            &orphan,
            serde_json::json!({"path": p.to_string_lossy(), "text": "Versión sin guardar\n", "saved_at": 1, "pid": 4_000_000u32})
                .to_string(),
        )
        .unwrap();
        let mut app = EditorApp::new(Doc::default(), None);
        app.set_drafts_dir(drafts.clone());
        app.recovery = crate::drafts::orphans(&drafts);
        let mut h = harness(app);
        h.run();
        assert!(h.query_by_label_contains("contrato.md").is_some(), "dice qué documento era");
        h.get_by_label("Recuperar").click();
        h.run_steps(2);
        let doc = h.state().doc();
        assert_eq!(doc.text, "Versión sin guardar\n");
        assert_eq!(doc.saved, "Versión guardada\n", "el archivo no se toca: queda con cambios sin guardar");
        assert_eq!(doc.path.as_deref(), Some(p.as_path()));
        assert!(!orphan.exists(), "recuperado, se borra");
    }
}

/// Captura de la ventana: `IUREDITOR_SHOT=/tmp/x.png cargo test shot -- --ignored`.
#[cfg(test)]
mod shot {
    use super::*;

    #[test]
    #[ignore = "captura para revisar la interfaz"]
    fn shot() {
        let Some(out) = std::env::var_os("IUREDITOR_SHOT") else { return };
        let text = "# Propuesta para Altamira\n\nAcuerdos de la **reunión** del martes con *Ana* y [el despacho](https://x.mx); falta la aceptacion del cliente.\n\n## Pendientes\n\n- [ ] Llamar al notario\n- [x] Enviar propuesta\n  - con anexos\n\n> Nota: revisar `contrato.md` antes del jueves.\n\n| Concepto | Monto |\n|---|--:|\n| Honorarios | 12 000 |\n\n```rust\n// Honorarios por hora\nfn honorarios(horas: u32) -> u32 {\n    horas * 1_500 // pesos\n}\n```\n\n```mermaid\ngraph LR; Propuesta --> Firma --> Audiencia\n```\n\n> [!MINDMAP|map] Estrategia\n> - Análisis\n>   - Contrato\n> - Negociación\n";
        // Una carpeta con una imagen junto al documento (se ve en su lugar).
        let dir = std::env::temp_dir().join(format!("iureditor-shot-{}", std::process::id()));
        let _ = std::fs::create_dir_all(dir.join("img"));
        let logo = image::RgbaImage::from_fn(360, 120, |x, y| {
            let t = x as f32 / 360.0;
            image::Rgba([
                (30.0 + 40.0 * t) as u8,
                (64.0 + 80.0 * t) as u8,
                175,
                if (x / 12 + y / 12) % 7 == 0 { 230 } else { 255 },
            ])
        });
        let _ = logo.save(dir.join("img/sello.png"));
        let text = text.replacen("\n\n## Pendientes", "\n\n![Sello del despacho](img/sello.png)\n\n## Pendientes", 1);
        let doc = Doc { path: Some(dir.join("propuesta.md")), saved: text.clone(), text, mtime: None };
        let mut app = EditorApp::new(doc, None);
        // `IUREDITOR_SHOT_TABS=1`: dos pestañas más (una con cambios), la primera activa.
        if std::env::var_os("IUREDITOR_SHOT_TABS").is_some() {
            let mut c = Doc { path: Some("contrato-arrendamiento.md".into()), ..Default::default() };
            c.text = "# Contrato\n".into();
            app.push_tab(c);
            app.push_tab(Doc { path: Some("minuta-12-10.md".into()), ..Default::default() });
            app.active = 0;
        }
        // `IUREDITOR_SHOT_RECOVERY=1`: la ventana para recuperar un borrador.
        if std::env::var_os("IUREDITOR_SHOT_RECOVERY").is_some() {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            app.recovery = vec![(
                PathBuf::from("/nada"),
                crate::drafts::Draft {
                    path: Some("contrato.md".into()),
                    text: "x".into(),
                    saved_at: now - 600,
                    pid: 1,
                },
            )];
        }
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(1000.0, 700.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run_steps(4);
        // Los diagramas llegan de otro hilo: se espera a que estén dibujados.
        for _ in 0..600 {
            h.step();
            use egui_kittest::kittest::Queryable;
            if h.query_all_by_label_contains("Diagrama").count() >= 2
                && h.query_all_by_label_contains("Imagen").count() >= 1
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        // Las gramáticas del código se cargan en otro hilo.
        let _ = iure_doc_ui::wait_highlighting(std::time::Duration::from_secs(20));
        // El corrector carga los diccionarios en otro hilo.
        for _ in 0..500 {
            if h.state().speller.is_ready() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        h.run_steps(2);
        // `IUREDITOR_SHOT_SPAN=1`: selección que cruza bloques (de «reunión» a «Pendientes»).
        if std::env::var_os("IUREDITOR_SHOT_SPAN").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Documento").focus();
            h.run_steps(2);
            h.key_press(Key::ArrowDown);
            h.run_steps(2);
            for _ in 0..2 {
                h.key_press_modifiers(Modifiers::SHIFT, Key::ArrowDown);
                h.run_steps(2);
            }
            h.key_press_modifiers(Modifiers::SHIFT, Key::End);
            h.run_steps(3);
        }
        // `IUREDITOR_SHOT_FIND=1`: buscar «propuesta» (Ctrl+F) con sus coincidencias resaltadas.
        if std::env::var_os("IUREDITOR_SHOT_FIND").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Documento").focus();
            h.run_steps(2);
            h.key_press_modifiers(Modifiers::COMMAND, Key::F);
            h.run_steps(2);
            h.get_by_label("Buscar").type_text("propuesta");
            h.run_steps(3);
        }
        // `IUREDITOR_SHOT_CELL=1`: una celda de la tabla con el foco (se ve su barra).
        if std::env::var_os("IUREDITOR_SHOT_CELL").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Fila 2, columna 2").focus();
            h.run_steps(3);
        }
        let img = h.render().unwrap();
        img.save(out).unwrap();
    }
}
