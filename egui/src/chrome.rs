//! El marco de la ventana, como IureEditor 1.x: barra de título con el menú ☰ y las pestañas (y
//! los botones de la ventana, sin la barra del sistema), barra de formato y barra de estado.

use egui::{Align, Key, KeyboardShortcut, Layout, Modifiers, RichText, Sense, Ui, vec2};
use iurefficient_ui::window::{self, WindowChrome};
use iurefficient_ui::{Icon, icons, pick, theme};

use crate::app::EditorApp;

/// Lo que se eligió en el menú ☰ (se hace fuera del menú, con la app libre).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MenuAct {
    New,
    Open,
    Save,
    SaveAs,
    Export(crate::export::Format),
    CloseTab,
    Quit,
    Undo,
    Redo,
    About,
    /// Mostrar u ocultar el panel lateral.
    ToggleSidebar,
}

const NEW: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::N);
const OPEN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::O);
const SAVE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::S);
const SAVE_AS: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::S);
const CLOSE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::W);
const QUIT: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Q);
const UNDO: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Z);
const REDO: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::Z);

/// Un renglón del menú con su atajo a la derecha.
fn item(ui: &mut Ui, label: &str, shortcut: Option<&KeyboardShortcut>) -> bool {
    let ctx = ui.ctx().clone();
    let c = theme::colors(ui);
    let w = ui.available_width().max(230.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 26.0), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect, 4.0, c.hover);
    }
    let font = theme::body_font(&ctx);
    ui.painter().text(rect.left_center() + vec2(10.0, 0.0), egui::Align2::LEFT_CENTER, label, font.clone(), c.text);
    if let Some(k) = shortcut {
        ui.painter().text(
            rect.right_center() - vec2(10.0, 0.0),
            egui::Align2::RIGHT_CENTER,
            ctx.format_shortcut(k),
            egui::FontId::proportional(font.size * 0.9),
            c.text_muted,
        );
    }
    iurefficient_ui::a11y::button(&resp, label);
    resp.clicked()
}

/// El menú ☰: Archivo, Edición y Ayuda, en secciones que se despliegan.
fn menu(ui: &mut Ui) -> Option<MenuAct> {
    use crate::export::Format;
    let mut act = None;
    ui.set_min_width(250.0);
    egui::CollapsingHeader::new(pick("File", "Archivo")).default_open(true).show(ui, |ui| {
        let mut pick_act = |ui: &mut Ui, label: &str, k: Option<&KeyboardShortcut>, a: MenuAct| {
            if item(ui, label, k) {
                act = Some(a);
            }
        };
        pick_act(ui, pick("New", "Nuevo"), Some(&NEW), MenuAct::New);
        pick_act(ui, pick("Open…", "Abrir…"), Some(&OPEN), MenuAct::Open);
        ui.separator();
        pick_act(ui, pick("Save", "Guardar"), Some(&SAVE), MenuAct::Save);
        pick_act(ui, pick("Save as…", "Guardar como…"), Some(&SAVE_AS), MenuAct::SaveAs);
        ui.separator();
        pick_act(ui, pick("Export to PDF…", "Exportar a PDF…"), None, MenuAct::Export(Format::Pdf));
        pick_act(ui, pick("Export to Word (DOCX)…", "Exportar a Word (DOCX)…"), None, MenuAct::Export(Format::Docx));
        pick_act(ui, pick("Export to HTML…", "Exportar a HTML…"), None, MenuAct::Export(Format::Html));
        ui.separator();
        pick_act(ui, pick("Close tab", "Cerrar pestaña"), Some(&CLOSE), MenuAct::CloseTab);
        pick_act(ui, pick("Quit", "Salir"), Some(&QUIT), MenuAct::Quit);
    });
    egui::CollapsingHeader::new(pick("Edit", "Edición")).default_open(false).show(ui, |ui| {
        if item(ui, pick("Undo", "Deshacer"), Some(&UNDO)) {
            act = Some(MenuAct::Undo);
        }
        if item(ui, pick("Redo", "Rehacer"), Some(&REDO)) {
            act = Some(MenuAct::Redo);
        }
    });
    egui::CollapsingHeader::new(pick("Help", "Ayuda")).default_open(false).show(ui, |ui| {
        if item(ui, pick("About IureEditor", "Acerca de IureEditor"), None) {
            act = Some(MenuAct::About);
        }
    });
    act
}

/// La barra de título: menú ☰, pestañas (con «+») y los botones de la ventana. Sin la barra del
/// sistema, su fondo mueve la ventana.
pub(crate) fn title_bar(app: &mut EditorApp, ui: &mut Ui, chrome: Option<&WindowChrome>) -> Option<MenuAct> {
    let ctx = ui.ctx().clone();
    let c = theme::colors(ui);
    let h = window::title_bar_height(&ctx) + 4.0;
    let mut act = None;
    let frame =
        egui::Frame::new().fill(c.surface_alt).inner_margin(egui::Margin { left: 6, right: 6, top: 0, bottom: 0 });
    egui::Panel::top("iureditor-title").exact_size(h).resizable(false).frame(frame).show(ui, |ui| {
        let inner = ui.max_rect();
        if chrome.is_some() {
            window::drag_area(ui, inner.expand2(vec2(6.0, 0.0)), egui::Id::unique("iureditor-drag"));
        }
        ui.horizontal_centered(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            if let Some(ch) = chrome {
                ui.add_space(ch.left_inset(&ctx));
                window::window_buttons(ui, ch, false, h);
            }
            if fmt_button(
                ui,
                Fmt::Draw(Glyph::Sidebar),
                pick("Show / hide the side panel", "Mostrar / ocultar el panel lateral"),
            ) {
                act = Some(MenuAct::ToggleSidebar);
            }
            let m = icons::icon_button(ui, Icon::Menu, pick("Menu", "Menú"), true);
            egui::Popup::menu(&m).show(|ui| {
                if let Some(a) = menu(ui) {
                    act = Some(a);
                    ui.close();
                }
            });
            ui.add_space(4.0);
            // Botones de la ventana a la derecha; las pestañas en lo que queda.
            let right_w = chrome.map_or(0.0, |ch| {
                let n = ch.layout.right.len() as f32;
                if ch.style == window::ControlStyle::Windows { n * 46.0 } else { n * 32.0 + 8.0 }
            });
            let tabs_w = (ui.available_width() - right_w).max(80.0);
            ui.allocate_ui_with_layout(vec2(tabs_w, h), Layout::left_to_right(Align::Center), |ui| {
                app.tab_strip(ui);
            });
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if let Some(ch) = chrome {
                    window::window_buttons(ui, ch, true, h);
                }
            });
        });
    });
    act
}

/// Botón de la barra de formato: un icono o un texto corto (H1, B, I…).
fn fmt_button(ui: &mut Ui, label: Fmt<'_>, tip: &str) -> bool {
    let c = theme::colors(ui);
    let (rect, resp) = ui.allocate_exact_size(vec2(28.0, 28.0), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect, 5.0, c.hover);
    }
    match label {
        Fmt::Icon(ic) => icons::paint(ui.painter(), rect.shrink(6.0), ic, c.text, c.accent),
        Fmt::Draw(g) => draw_glyph(ui.painter(), rect.shrink(7.0), g, c.text),
        Fmt::Text(t, style) => {
            let size = 13.5;
            let font = match style {
                TextStyle::Bold => theme::bold_font(ui.ctx(), size),
                TextStyle::Mono => egui::FontId::monospace(size - 1.0),
                TextStyle::Plain | TextStyle::Italic | TextStyle::Strike => egui::FontId::proportional(size),
            };
            let galley = ui.painter().layout_no_wrap(t.to_string(), font, c.text);
            let pos = rect.center() - galley.size() / 2.0;
            let mut job_galley = galley;
            if style == TextStyle::Italic {
                let mut job = egui::text::LayoutJob::default();
                job.append(
                    t,
                    0.0,
                    egui::TextFormat {
                        font_id: egui::FontId::proportional(size),
                        color: c.text,
                        italics: true,
                        ..Default::default()
                    },
                );
                job_galley = ui.painter().layout_job(job);
            }
            ui.painter().galley(pos, job_galley, c.text);
            if style == TextStyle::Strike {
                let y = rect.center().y;
                ui.painter().line_segment(
                    [egui::pos2(rect.center().x - 6.0, y), egui::pos2(rect.center().x + 6.0, y)],
                    egui::Stroke::new(1.2, c.text),
                );
            }
        }
    }
    iurefficient_ui::a11y::button(&resp, tip);
    resp.on_hover_text(tip).clicked()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextStyle {
    Plain,
    Bold,
    Italic,
    Strike,
    Mono,
}

#[derive(Clone, Copy)]
enum Fmt<'a> {
    Icon(Icon),
    Text(&'a str, TextStyle),
    /// Dibujados con líneas (sin depender de los glifos de la letra).
    Draw(Glyph),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Glyph {
    Quote,
    Table,
    Diagram,
    Rule,
    /// Panel lateral (un recuadro con su columna izquierda).
    Sidebar,
}

/// Dibuja un icono de la barra de formato que no está en el kit.
fn draw_glyph(p: &egui::Painter, r: egui::Rect, g: Glyph, ink: egui::Color32) {
    let s = egui::Stroke::new(1.4, ink);
    let at = |x: f32, y: f32| egui::pos2(r.left() + x * r.width(), r.top() + y * r.height());
    match g {
        Glyph::Quote => {
            p.line_segment([at(0.2, 0.15), at(0.2, 0.85)], egui::Stroke::new(2.4, ink));
            for y in [0.3, 0.5, 0.7] {
                p.line_segment([at(0.38, y), at(0.85, y)], s);
            }
        }
        Glyph::Table => {
            p.rect_stroke(egui::Rect::from_min_max(at(0.1, 0.18), at(0.9, 0.82)), 1.5, s, egui::StrokeKind::Middle);
            p.line_segment([at(0.1, 0.4), at(0.9, 0.4)], s);
            p.line_segment([at(0.1, 0.61), at(0.9, 0.61)], s);
            p.line_segment([at(0.5, 0.18), at(0.5, 0.82)], s);
        }
        Glyph::Diagram => {
            p.rect_stroke(egui::Rect::from_min_max(at(0.05, 0.38), at(0.35, 0.62)), 1.5, s, egui::StrokeKind::Middle);
            p.rect_stroke(egui::Rect::from_min_max(at(0.65, 0.1), at(0.95, 0.34)), 1.5, s, egui::StrokeKind::Middle);
            p.rect_stroke(egui::Rect::from_min_max(at(0.65, 0.66), at(0.95, 0.9)), 1.5, s, egui::StrokeKind::Middle);
            p.line_segment([at(0.35, 0.5), at(0.65, 0.22)], s);
            p.line_segment([at(0.35, 0.5), at(0.65, 0.78)], s);
        }
        Glyph::Rule => {
            p.line_segment([at(0.1, 0.5), at(0.9, 0.5)], egui::Stroke::new(1.8, ink));
        }
        Glyph::Sidebar => {
            p.rect_stroke(egui::Rect::from_min_max(at(0.08, 0.15), at(0.92, 0.85)), 2.0, s, egui::StrokeKind::Middle);
            p.line_segment([at(0.38, 0.15), at(0.38, 0.85)], s);
        }
    }
}

/// La barra de formato: cada botón le pide al editor la acción sobre la selección.
pub(crate) fn format_bar(app: &mut EditorApp, ui: &mut Ui) {
    use iure_doc::edit::LineKind;
    use iure_doc_ui::ExternalEdit as E;
    let c = theme::colors(ui);
    let frame = egui::Frame::new().fill(c.surface).inner_margin(egui::Margin::symmetric(8, 3));
    let mut act: Option<E> = None;
    egui::Panel::top("iureditor-format").frame(frame).resizable(false).show(ui, |ui| {
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 1.0;
            let sep = |ui: &mut Ui| {
                ui.add_space(4.0);
                ui.separator();
                ui.add_space(4.0);
            };
            let mut b = |ui: &mut Ui, f: Fmt<'_>, tip: &str, e: E| {
                if fmt_button(ui, f, tip) {
                    act = Some(e);
                }
            };
            b(ui, Fmt::Icon(Icon::Undo), pick("Undo (Ctrl+Z)", "Deshacer (Ctrl+Z)"), E::Undo);
            b(ui, Fmt::Icon(Icon::Redo), pick("Redo (Ctrl+Shift+Z)", "Rehacer (Ctrl+Mayús+Z)"), E::Redo);
            sep(ui);
            for n in 1..=3u8 {
                let t = ["H1", "H2", "H3"].get(usize::from(n - 1)).copied().unwrap_or("H");
                b(
                    ui,
                    Fmt::Text(t, TextStyle::Bold),
                    &format!("{} {n}", pick("Heading", "Título")),
                    E::Line(LineKind::Heading(n)),
                );
            }
            sep(ui);
            b(ui, Fmt::Text("B", TextStyle::Bold), pick("Bold (Ctrl+B)", "Negrita (Ctrl+B)"), E::Wrap("**".into()));
            b(ui, Fmt::Text("I", TextStyle::Italic), pick("Italic (Ctrl+I)", "Cursiva (Ctrl+I)"), E::Wrap("*".into()));
            b(ui, Fmt::Text("S", TextStyle::Strike), pick("Strikethrough", "Tachado"), E::Wrap("~~".into()));
            b(ui, Fmt::Text("</>", TextStyle::Mono), pick("Inline code", "Código en línea"), E::Wrap("`".into()));
            sep(ui);
            b(ui, Fmt::Icon(Icon::List), pick("Bulleted list", "Lista con viñetas"), E::Line(LineKind::Bullet));
            b(
                ui,
                Fmt::Text("1.", TextStyle::Plain),
                pick("Numbered list", "Lista numerada"),
                E::Line(LineKind::Ordered),
            );
            b(ui, Fmt::Icon(Icon::Tasks), pick("Task list", "Lista de tareas"), E::Line(LineKind::Task));
            sep(ui);
            b(ui, Fmt::Draw(Glyph::Quote), pick("Quote", "Cita"), E::Quote);
            b(
                ui,
                Fmt::Text("{ }", TextStyle::Mono),
                pick("Code block", "Bloque de código"),
                E::Insert("\n```\n\n```\n".into()),
            );
            b(ui, Fmt::Draw(Glyph::Rule), pick("Horizontal rule", "Línea horizontal"), E::Insert("\n\n---\n\n".into()));
            sep(ui);
            b(ui, Fmt::Icon(Icon::Hyperlink), pick("Link", "Enlace"), E::Link);
            b(
                ui,
                Fmt::Draw(Glyph::Table),
                pick("Table", "Tabla"),
                E::Insert("\n\n| Columna 1 | Columna 2 |\n| --- | --- |\n|  |  |\n\n".into()),
            );
            b(
                ui,
                Fmt::Draw(Glyph::Diagram),
                pick("Diagram (Mermaid)", "Diagrama (Mermaid)"),
                E::Insert("\n\n```mermaid\nflowchart LR\n  A[Inicio] --> B[Fin]\n```\n\n".into()),
            );
        });
    });
    if let Some(e) = act {
        app.apply_to_active(ui.ctx(), e);
    }
}

/// La barra de estado: línea, palabras, caracteres y si está guardado.
pub(crate) fn status_bar(app: &EditorApp, ui: &mut Ui) {
    let c = theme::colors(ui);
    let frame = egui::Frame::new().fill(c.surface_alt).inner_margin(egui::Margin::symmetric(12, 4));
    egui::Panel::bottom("iureditor-status").frame(frame).resizable(false).show(ui, |ui| {
        let (line, words, chars) = app.counts(ui.ctx());
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 18.0;
            let size = theme::density(ui.ctx()).small_size();
            let small = move |s: String| RichText::new(s).size(size).color(c.text_muted);
            ui.label(small(format!("{} {line}", pick("Line", "Línea"))));
            ui.label(small(format!("{words} {}", pick("words", "palabras"))));
            ui.label(small(format!("{chars} {}", pick("characters", "caracteres"))));
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                let state = if app.doc().dirty() {
                    pick("Unsaved changes", "Cambios sin guardar")
                } else {
                    pick("Saved", "Guardado")
                };
                ui.label(small(state.to_string()));
            });
        });
    });
}
