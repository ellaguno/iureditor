//! La ventana: barra con las acciones del archivo y el editor de documentos de la suite.

use std::path::PathBuf;
use std::sync::mpsc;

use egui::{Key, KeyboardShortcut, Modifiers};
use iurefficient_ui::lang::pick;

use crate::doc::Doc;

/// Qué se hará cuando se resuelva «¿guardar los cambios?».
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Then {
    New,
    Open,
    Close,
}

/// Respuesta de un diálogo de archivo (corre en otro hilo: la ventana no se congela).
enum Picked {
    Open(Option<PathBuf>),
    SaveAs(Option<PathBuf>, Option<Then>),
}

pub struct EditorApp {
    doc: Doc,
    /// Generación del documento: el estado del editor (cursor, deshacer) es por documento.
    generation: u64,
    notice: Option<String>,
    picker: Option<mpsc::Receiver<Picked>>,
    /// «¿Guardar los cambios?» pendiente.
    ask: Option<Then>,
    /// Cerrar sin volver a preguntar.
    closing: bool,
    /// Última vez que se miró si otro programa cambió el archivo.
    disk_check: f64,
    title: String,
    themed: bool,
    /// Corrector ortográfico (diccionarios del sistema, español e inglés; uno para la app).
    speller: std::sync::Arc<iure_doc_ui::Speller>,
    /// Borradores de recuperación (carpeta; `None`: sin carpeta de datos).
    drafts: Option<PathBuf>,
    /// Huella del texto y cuándo cambió por última vez (segundos de egui).
    seen: (u64, f64),
    /// Huella del último borrador escrito (0: ninguno).
    drafted: u64,
    /// Generación de borradores: un borrador que tarda no reaparece tras guardar o descartar.
    draft_gen: std::sync::Arc<std::sync::Mutex<u64>>,
    /// Borradores de un cierre inesperado, para ofrecer recuperarlos (el más reciente primero).
    pub(crate) recovery: Vec<(PathBuf, crate::drafts::Draft)>,
}

/// Espera tras el último cambio antes de escribir el borrador (como IureEditor Tauri).
const DRAFT_DELAY: f64 = 2.5;

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

impl EditorApp {
    pub fn new(doc: Doc, notice: Option<String>) -> Self {
        EditorApp {
            doc,
            generation: 0,
            notice,
            picker: None,
            ask: None,
            closing: false,
            disk_check: 0.0,
            title: String::new(),
            themed: false,
            speller: iure_doc_ui::Speller::system(iure_doc_ui::spell::personal_path("iureditor")),
            // En las pruebas no se tocan los borradores del usuario (cada prueba pone su carpeta).
            drafts: if cfg!(test) { None } else { crate::drafts::drafts_dir() },
            seen: (0, 0.0),
            drafted: 0,
            draft_gen: std::sync::Arc::new(std::sync::Mutex::new(0)),
            recovery: Vec::new(),
        }
    }

    fn replace(&mut self, doc: Doc) {
        self.doc = doc;
        self.generation = self.generation.wrapping_add(1);
    }

    fn open_dialog(&mut self) {
        let (tx, rx) = mpsc::channel();
        let dir = self.doc.path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
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
            .doc
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| format!("{}.md", pick("document", "documento")), |n| n.to_string_lossy().into_owned());
        std::thread::spawn(move || {
            let d = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown", "txt"]).set_file_name(name);
            let _ = tx.send(Picked::SaveAs(d.save_file(), then));
        });
        self.picker = Some(rx);
    }

    /// Guarda; sin archivo, pregunta dónde. `true` si quedó guardado.
    fn save(&mut self, then: Option<Then>) -> bool {
        if self.doc.path.is_none() {
            self.save_as_dialog(then);
            return false;
        }
        match self.doc.save(None) {
            Ok(()) => true,
            Err(e) => {
                let p = self.doc.path.clone().unwrap_or_default();
                self.notice = Some(e.human(&p));
                false
            }
        }
    }

    fn act(&mut self, ctx: &egui::Context, then: Then) {
        if self.doc.dirty() {
            self.ask = Some(then);
            return;
        }
        self.run(ctx, then);
    }

    fn run(&mut self, ctx: &egui::Context, then: Then) {
        match then {
            Then::New => self.replace(Doc::default()),
            Then::Open => self.open_dialog(),
            Then::Close => {
                self.closing = true;
                self.clear_draft();
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }

    /// Usa otra carpeta de borradores (pruebas).
    #[cfg(test)]
    pub(crate) fn set_drafts_dir(&mut self, dir: PathBuf) {
        self.drafts = Some(dir);
    }

    /// Borra el borrador de esta ventana (y anula uno que se esté escribiendo).
    fn clear_draft(&mut self) {
        let Some(dir) = &self.drafts else { return };
        let mut g = self.draft_gen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        *g = g.wrapping_add(1);
        crate::drafts::clear(dir);
        self.drafted = 0;
    }

    /// Con cambios sin guardar, escribe el borrador 2,5 s después del último cambio (en otro
    /// hilo); sin cambios, lo borra.
    fn draft_tick(&mut self, ctx: &egui::Context) {
        let Some(dir) = self.drafts.clone() else { return };
        let now = ctx.input(|i| i.time);
        let h = hash_text(&self.doc.text);
        if h != self.seen.0 {
            self.seen = (h, now);
        }
        if !self.doc.dirty() {
            if self.drafted != 0 {
                self.clear_draft();
            }
            return;
        }
        if self.drafted == h {
            return;
        }
        let wait = DRAFT_DELAY - (now - self.seen.1);
        if wait > 0.0 {
            ctx.request_repaint_after(std::time::Duration::from_secs_f64(wait));
            return;
        }
        self.drafted = h;
        let gen_lock = std::sync::Arc::clone(&self.draft_gen);
        let my_gen = *gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let (path, text) = (self.doc.path.clone(), self.doc.text.clone());
        std::thread::spawn(move || {
            let g = gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            if *g == my_gen {
                let _ = crate::drafts::write(&dir, path.as_deref(), &text);
            }
        });
    }

    /// «¿Recuperar lo que no se guardó?» tras un cierre inesperado.
    fn recovery_window(&mut self, ctx: &egui::Context) {
        let Some((file, draft)) = self.recovery.first().cloned() else { return };
        let name = draft
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| pick("Untitled", "Sin título").to_string(), |n| n.to_string_lossy().into_owned());
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let mins = now.saturating_sub(draft.saved_at) / 60;
        let when = match mins {
            0 => pick("less than a minute ago", "hace menos de un minuto").to_string(),
            m if m < 120 => format!("{} {m} min", pick("about", "hace")),
            m => format!("{} {} h", pick("about", "hace"), m / 60),
        };
        let more = self.recovery.len() - 1;
        let mut answer: Option<bool> = None;
        egui::Window::new(pick("Recover unsaved changes?", "¿Recuperar lo que no se guardó?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(format!(
                    "{} «{name}» ({when}).",
                    pick(
                        "IureEditor closed unexpectedly with unsaved changes in",
                        "IureEditor se cerró sin guardar los cambios de"
                    )
                ));
                if more > 0 {
                    ui.weak(format!("{} {more}", pick("Other drafts:", "Otros borradores:")));
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
                // El documento con el texto del borrador encima (queda con cambios sin guardar).
                let mut doc = match &draft.path {
                    Some(p) if p.is_file() => {
                        Doc::open(p).unwrap_or_else(|_| Doc { path: Some(p.clone()), ..Default::default() })
                    }
                    Some(p) => Doc { path: Some(p.clone()), ..Default::default() },
                    None => Doc::default(),
                };
                doc.text = draft.text;
                self.replace(doc);
                crate::drafts::remove(&[file]);
                self.recovery.remove(0);
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
            Picked::Open(Some(path)) => match Doc::open(&path) {
                Ok(d) => self.replace(d),
                Err(e) => self.notice = Some(e.human(&path)),
            },
            Picked::SaveAs(Some(path), then) => match self.doc.save(Some(&path)) {
                Ok(()) => {
                    if let Some(t) = then {
                        self.run(ctx, t);
                    }
                }
                Err(e) => self.notice = Some(e.human(&path)),
            },
            Picked::Open(None) | Picked::SaveAs(None, _) => {}
        }
    }

    /// Si otro programa cambió el archivo: sin cambios propios se vuelve a leer; con cambios, se
    /// avisa (no se pisa nada).
    fn check_disk(&mut self, now: f64) {
        if now - self.disk_check < 2.0 {
            return;
        }
        self.disk_check = now;
        if !self.doc.changed_on_disk() {
            return;
        }
        let Some(path) = self.doc.path.clone() else {
            return;
        };
        if self.doc.dirty() {
            self.notice = Some(
                pick(
                    "Another program changed this file; saving will replace its version.",
                    "Otro programa cambió este archivo; al guardar se reemplaza su versión.",
                )
                .to_string(),
            );
            self.doc.mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        } else if let Ok(d) = Doc::open(&path) {
            self.replace(d);
        }
    }

    fn bar(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        ui.horizontal(|ui| {
            if ui.button(pick("New", "Nuevo")).on_hover_text(ctx.format_shortcut(&NEW)).clicked() {
                self.act(&ctx, Then::New);
            }
            if ui.button(pick("Open…", "Abrir…")).on_hover_text(ctx.format_shortcut(&OPEN)).clicked() {
                self.act(&ctx, Then::Open);
            }
            if ui.button(pick("Save", "Guardar")).on_hover_text(ctx.format_shortcut(&SAVE)).clicked() {
                self.save(None);
            }
            if ui.button(pick("Save as…", "Guardar como…")).on_hover_text(ctx.format_shortcut(&SAVE_AS)).clicked() {
                self.save_as_dialog(None);
            }
            ui.separator();
            let state = if self.doc.dirty() {
                pick("Unsaved changes", "Cambios sin guardar")
            } else {
                pick("Saved", "Guardado")
            };
            ui.weak(state);
        });
        if let Some(n) = self.notice.clone() {
            ui.horizontal(|ui| {
                ui.colored_label(iurefficient_ui::theme::colors(ui).danger, n);
                if ui.small_button(pick("Close", "Cerrar")).clicked() {
                    self.notice = None;
                }
            });
        }
    }

    fn ask_window(&mut self, ctx: &egui::Context) {
        let Some(then) = self.ask else { return };
        let mut answer: Option<Option<bool>> = None;
        egui::Window::new(pick("Save changes?", "¿Guardar los cambios?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(pick(
                    "This document has changes that are not saved.",
                    "Este documento tiene cambios sin guardar.",
                ));
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
                self.doc.saved = self.doc.text.clone();
                // «No guardar»: sin borrador huérfano.
                self.clear_draft();
                self.run(ctx, then);
            }
            Some(None) => self.ask = None,
            None => {}
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
        // Cerrar con cambios sin guardar pregunta antes.
        if ctx.input(|i| i.viewport().close_requested()) && !self.closing && self.doc.dirty() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.ask = Some(Then::Close);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE_AS)) {
            self.save_as_dialog(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE)) {
            self.save(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&OPEN)) {
            self.act(&ctx, Then::Open);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&NEW)) {
            self.act(&ctx, Then::New);
        }
        self.poll_picker(&ctx);
        self.draft_tick(&ctx);
        self.check_disk(ctx.input(|i| i.time));
        let title = self.doc.title();
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
                    // Diagramas (Mermaid, mapas mentales) e imágenes de la carpeta del documento,
                    // dibujados en su lugar.
                    let folder = self.doc.path.as_ref().and_then(|p| p.parent()).map(std::path::Path::to_path_buf);
                    let diagrams: std::sync::Arc<dyn iure_doc_ui::DiagramRenderer> =
                        std::sync::Arc::new(iure_doc_ui::Renderers(vec![
                            std::sync::Arc::new(crate::diagrams::Diagrams::new(ui)),
                            std::sync::Arc::new(iure_doc_ui::LocalImages::new(folder)),
                        ]));
                    // Pegar de la web, Word o Google Docs pega su Markdown (el HTML del portapapeles).
                    let hooks = iure_doc_ui::Hooks {
                        diagrams: Some(diagrams),
                        paste: Some(std::sync::Arc::new(iure_doc_ui::SystemClipboard)),
                        spell: Some(self.speller.clone()),
                    };
                    let out = iure_doc_ui::show_blocks_hooks(
                        ui,
                        egui::Id::unique(("iureditor-doc", self.generation)),
                        &mut self.doc.text,
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
        assert!(h.state().doc.dirty());
        assert!(h.state().title.starts_with("• "));
        h.key_press_modifiers(Modifiers::COMMAND, Key::S);
        h.run();
        assert!(!h.state().doc.dirty());
        // Al enfocar, el cursor queda al final del primer bloque.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Título¡\n\nTexto\n");
    }

    #[test]
    fn new_with_unsaved_changes_asks_first() {
        let d = Doc { text: "borrador".into(), ..Default::default() };
        let app = EditorApp::new(d, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        h.get_by_label("Nuevo").click();
        h.run();
        assert_eq!(h.state().ask, Some(Then::New));
        h.get_by_label("No guardar").click();
        h.run();
        assert!(h.state().doc.text.is_empty() && h.state().ask.is_none());
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
        assert_eq!(h.state().doc.text, text, "dibujarlo no cambia el documento");
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
mod draft_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    fn harness(app: EditorApp) -> egui_kittest::Harness<'static, EditorApp> {
        egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app)
    }

    fn my_draft(dir: &std::path::Path) -> PathBuf {
        dir.join(format!("{}.json", std::process::id()))
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
        h.get_by_label("Nuevo").click();
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
        let doc = &h.state().doc;
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
