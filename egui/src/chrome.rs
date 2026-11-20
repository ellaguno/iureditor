//! El marco de la ventana, como IureEditor 1.x: barra de título con el menú ☰ y las pestañas (y
//! los botones de la ventana, sin la barra del sistema), barra de formato y barra de estado.

use egui::{Align, Key, KeyboardShortcut, Layout, Modifiers, RichText, Sense, Ui, vec2};
use iurefficient_ui::window::{self, WindowChrome};
use iurefficient_ui::{Icon, icons, pick, theme};

use iure_doc_ui::toolbar::{Fmt, Glyph, fmt_button};

use crate::app::EditorApp;

/// Lo que se eligió en el menú ☰ (se hace fuera del menú, con la app libre).
#[derive(Clone, Debug, PartialEq, Eq)]
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
    /// Buscar en los archivos de la carpeta (panel lateral).
    FindInFiles,
    /// El esquema del documento (panel lateral).
    Outline,
    ZoomIn,
    ZoomOut,
    ZoomReset,
    Theme(iurefficient_ui::theme::ThemeMode),
    /// Fuente (clave de `FontChoice`).
    Font(String),
    TextScale(u32),
    Crisp(bool),
    Density(iurefficient_ui::Density),
}

const NEW: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::N);
const OPEN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::O);
const SAVE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::S);
const SAVE_AS: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::S);
const CLOSE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::W);
const QUIT: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Q);
const UNDO: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Z);
const REDO: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::Z);
const FIND_ALL: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::F);

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
/// Un renglón del menú que se marca (el tema elegido).
fn item_checked(ui: &mut Ui, label: &str, checked: bool) -> bool {
    let c = theme::colors(ui);
    let w = ui.available_width().max(230.0);
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 26.0), Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect, 4.0, c.hover);
    }
    if checked {
        ui.painter().circle_filled(rect.left_center() + vec2(12.0, 0.0), 3.5, c.accent);
    }
    let font = theme::body_font(ui.ctx());
    ui.painter().text(rect.left_center() + vec2(24.0, 0.0), egui::Align2::LEFT_CENTER, label, font, c.text);
    iurefficient_ui::a11y::row(&resp, label, checked);
    resp.clicked()
}

fn menu(ui: &mut Ui, current: iurefficient_ui::theme::ThemeMode, look: &crate::drafts::Appearance) -> Option<MenuAct> {
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
    egui::CollapsingHeader::new(pick("View", "Ver")).default_open(false).show(ui, |ui| {
        let mut pick_act = |ui: &mut Ui, label: &str, k: Option<&KeyboardShortcut>, a: MenuAct| {
            if item(ui, label, k) {
                act = Some(a);
            }
        };
        pick_act(ui, pick("Side panel", "Panel lateral"), None, MenuAct::ToggleSidebar);
        pick_act(ui, pick("Outline", "Esquema"), None, MenuAct::Outline);
        pick_act(ui, pick("Find in files…", "Buscar en los archivos…"), Some(&FIND_ALL), MenuAct::FindInFiles);
        ui.separator();
        pick_act(ui, pick("Zoom in", "Acercar"), Some(&crate::app::ZOOM_IN), MenuAct::ZoomIn);
        pick_act(ui, pick("Zoom out", "Alejar"), Some(&crate::app::ZOOM_OUT), MenuAct::ZoomOut);
        pick_act(ui, pick("Actual size", "Tamaño real"), Some(&crate::app::ZOOM_RESET), MenuAct::ZoomReset);
        ui.separator();
        use iurefficient_ui::theme::ThemeMode;
        for (mode, label) in [
            (ThemeMode::System, pick("Theme: system", "Tema: del sistema")),
            (ThemeMode::Light, pick("Theme: light", "Tema: claro")),
            (ThemeMode::Dark, pick("Theme: dark", "Tema: oscuro")),
        ] {
            if item_checked(ui, label, current == mode) {
                act = Some(MenuAct::Theme(mode));
            }
        }
        ui.separator();
        // Apariencia, como Preferencias › Apariencia de IureDesk e IureProject.
        use iurefficient_ui::fonts::FontChoice;
        let desktop = iurefficient_ui::fonts::desktop_font().map(|(f, _)| f);
        let font_label = |c: &FontChoice| match c {
            FontChoice::Bundled => pick("Inter (included)", "Inter (incluida)").to_string(),
            FontChoice::Desktop => match &desktop {
                Some(d) => format!("{} ({d})", pick("The desktop's", "La del escritorio")),
                None => pick("The desktop's", "La del escritorio").to_string(),
            },
            FontChoice::Family(f) => f.clone(),
        };
        let now = FontChoice::from_key(&look.font);
        ui.menu_button(format!("{}: {}", pick("Font", "Fuente"), font_label(&now)), |ui| {
            let mut all = vec![FontChoice::Bundled, FontChoice::Desktop];
            all.extend(iurefficient_ui::fonts::available_families().into_iter().map(FontChoice::Family));
            egui::ScrollArea::vertical().max_height(320.0).show(ui, |ui| {
                for c in all {
                    if item_checked(ui, &font_label(&c), c == now) {
                        act = Some(MenuAct::Font(c.key()));
                    }
                }
            });
        });
        ui.menu_button(format!("{}: {} %", pick("Text size", "Tamaño del texto"), look.text_scale), |ui| {
            for pct in [90u32, 100, 110, 120, 130] {
                if item_checked(ui, &format!("{pct} %"), pct == look.text_scale) {
                    act = Some(MenuAct::TextScale(pct));
                }
            }
        });
        use iurefficient_ui::Density;
        let dname = |d: Density| match d {
            Density::Comfortable => pick("Comfortable", "Cómoda"),
            Density::Compact => pick("Compact", "Compacta"),
            Density::Dense => pick("Dense", "Densa"),
        };
        ui.menu_button(format!("{}: {}", pick("Density", "Densidad"), dname(look.density)), |ui| {
            for d in [Density::Comfortable, Density::Compact, Density::Dense] {
                if item_checked(ui, dname(d), d == look.density) {
                    act = Some(MenuAct::Density(d));
                }
            }
        });
        if item_checked(ui, pick("Sharper text", "Nitidez"), look.crisp) {
            act = Some(MenuAct::Crisp(!look.crisp));
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
            let current = app.theme;
            let look = app.look.clone();
            // Desplegar Archivo, Edición, Ver o Ayuda no cierra el menú; elegir algo, sí.
            egui::Popup::menu(&m).close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside).show(|ui| {
                if let Some(a) = menu(ui, current, &look) {
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

/// La barra de formato: cada botón le pide al editor la acción sobre la selección.
pub(crate) fn format_bar(app: &mut EditorApp, ui: &mut Ui) {
    use iure_doc_ui::toolbar::{self, Pressed};
    let c = theme::colors(ui);
    let frame = egui::Frame::new().fill(c.surface).inner_margin(egui::Margin::symmetric(8, 3));
    let mut act = None;
    egui::Panel::top("iureditor-format").frame(frame).resizable(false).show(ui, |ui| {
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 1.0;
            act = toolbar::tools(ui, toolbar::FULL);
        });
    });
    if let Some(Pressed::Edit(e)) = act {
        app.apply_to_active(ui.ctx(), e);
    }
}

/// La barra de estado: línea, palabras, caracteres, si está guardado y el zoom (− 100 % +; clic
/// en el porcentaje vuelve al 100 %).
pub(crate) fn status_bar(app: &EditorApp, ui: &mut Ui) -> Option<MenuAct> {
    let mut act = None;
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
                ui.spacing_mut().item_spacing.x = 4.0;
                let zoom_btn = |ui: &mut Ui, t: &str, tip: &str| {
                    ui.add(egui::Button::new(small(t.to_string())).frame(false).small()).on_hover_text(tip).clicked()
                };
                if zoom_btn(ui, "+", pick("Zoom in", "Acercar")) {
                    act = Some(MenuAct::ZoomIn);
                }
                let pct = format!("{} %", (app.zoom * 100.0).round() as i32);
                if zoom_btn(ui, &pct, pick("Actual size", "Tamaño real")) {
                    act = Some(MenuAct::ZoomReset);
                }
                if zoom_btn(ui, "−", pick("Zoom out", "Alejar")) {
                    act = Some(MenuAct::ZoomOut);
                }
                ui.add_space(14.0);
                let state = if app.doc().dirty() {
                    pick("Unsaved changes", "Cambios sin guardar")
                } else {
                    pick("Saved", "Guardado")
                };
                ui.label(small(state.to_string()));
            });
        });
    });
    act
}
