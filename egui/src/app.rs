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
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
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

/// Captura de la ventana: `IUREDITOR_SHOT=/tmp/x.png cargo test shot -- --ignored`.
#[cfg(test)]
mod shot {
    use super::*;

    #[test]
    #[ignore = "captura para revisar la interfaz"]
    fn shot() {
        let Some(out) = std::env::var_os("IUREDITOR_SHOT") else { return };
        let text = "# Propuesta para Altamira\n\nAcuerdos de la **reunión** del martes con *Ana* y [el despacho](https://x.mx); falta la aceptacion del cliente.\n\n## Pendientes\n\n- [ ] Llamar al notario\n- [x] Enviar propuesta\n  - con anexos\n\n> Nota: revisar `contrato.md` antes del jueves.\n\n| Concepto | Monto |\n|---|--:|\n| Honorarios | 12 000 |\n\n```mermaid\ngraph LR; Propuesta --> Firma --> Audiencia\n```\n\n> [!MINDMAP|map] Estrategia\n> - Análisis\n>   - Contrato\n> - Negociación\n";
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
        let app = EditorApp::new(doc, None);
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
