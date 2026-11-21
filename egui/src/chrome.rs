//! El marco de la ventana, como IureEditor 1.x: barra de título con el menú ☰ y las pestañas (y
//! los botones de la ventana, sin la barra del sistema), barra de formato y barra de estado.

use egui::{Align, Key, KeyboardShortcut, Layout, Modifiers, RichText, Sense, Ui, vec2};
use iurefficient_ui::window::{self, WindowChrome};
use iurefficient_ui::{Icon, icons, pick, theme};

use iure_doc_ui::toolbar::{Fmt, Glyph, fmt_button};

use crate::app::EditorApp;

/// Lo que se eligió en el menú ☰ (se hace fuera del menú, con la app libre).
#[derive(Clone, Debug, PartialEq)]
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
    ZoomIn,
    ZoomOut,
    ZoomReset,
    Theme(iurefficient_ui::theme::ThemeMode),
    /// Fuente (clave de `FontChoice`).
    Font(String),
    TextScale(u32),
    Crisp(bool),
    Density(iurefficient_ui::Density),
    /// Una pestaña del panel lateral (Iurefficient, Asistente, Archivos, Enlaces…).
    Side(crate::sidebar::SideTab),
    OpenFolder,
    /// Un documento nuevo desde la plantilla con este nombre.
    FromTemplate(String),
    OpenTemplatesFolder,
    OpenRecent(std::path::PathBuf),
    /// Ir a nota (Ctrl+K) y paleta de comandos (Ctrl+Mayús+P).
    QuickSwitcher,
    CommandPalette,
    Find,
    Replace,
    GotoLine,
    InsertToc,
    SelectAll,
    /// Ver el Markdown tal cual (Ctrl+Mayús+M) y sus números de línea (Ctrl+Mayús+N).
    SourceCode,
    LineNumbers,
    PageWidth(crate::drafts::PageWidth),
    Spellcheck(bool),
    Language(crate::drafts::LangPref),
    Help,
    Url(&'static str),
    CheckUpdates,
}

/// Lo que el menú necesita saber para marcar las opciones elegidas.
pub(crate) struct MenuState<'a> {
    pub theme: iurefficient_ui::theme::ThemeMode,
    pub look: &'a crate::drafts::Appearance,
    pub page: crate::drafts::PageWidth,
    pub spell: bool,
    pub source: bool,
    pub line_numbers: bool,
    pub lang: crate::drafts::LangPref,
    pub recent: &'a [std::path::PathBuf],
    pub templates: &'a [String],
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
const SHIFT_CMD: Modifiers = Modifiers { shift: true, ..Modifiers::COMMAND };
pub(crate) const FIND: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::F);
pub(crate) const REPLACE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::H);
pub(crate) const GOTO_LINE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::L);
pub(crate) const SELECT_ALL: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::A);
pub(crate) const QUICK: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::K);
pub(crate) const PALETTE: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::P);
pub(crate) const FILES: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::E);
pub(crate) const OUTLINE: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::O);
pub(crate) const LINKS: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::K);
pub(crate) const IURE: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::I);
pub(crate) const ASSIST: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::J);
pub(crate) const SOURCE: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::M);
pub(crate) const LINE_NUMBERS: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::N);
pub(crate) const PAGE_WIDTH: KeyboardShortcut = KeyboardShortcut::new(SHIFT_CMD, Key::A);
pub(crate) const HELP: KeyboardShortcut = KeyboardShortcut::new(Modifiers::NONE, Key::F1);

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
    item_checked_key(ui, label, checked, None)
}

/// Como [`item_checked`], con su atajo a la derecha.
fn item_checked_key(ui: &mut Ui, label: &str, checked: bool, shortcut: Option<&KeyboardShortcut>) -> bool {
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
    ui.painter().text(rect.left_center() + vec2(24.0, 0.0), egui::Align2::LEFT_CENTER, label, font.clone(), c.text);
    if let Some(k) = shortcut {
        ui.painter().text(
            rect.right_center() - vec2(10.0, 0.0),
            egui::Align2::RIGHT_CENTER,
            ui.ctx().format_shortcut(k),
            egui::FontId::proportional(font.size * 0.9),
            c.text_muted,
        );
    }
    iurefficient_ui::a11y::row(&resp, label, checked);
    resp.clicked()
}

fn menu(ui: &mut Ui, st: &MenuState<'_>) -> Option<MenuAct> {
    use crate::export::Format;
    use crate::sidebar::SideTab;
    let mut act = None;
    ui.set_min_width(290.0);
    ui.set_max_width(320.0);
    // Con muchas opciones abiertas, el menú se desplaza (no se sale de la ventana).
    let max_h = (ui.ctx().content_rect().height() - 90.0).max(200.0);
    // `min_scrolled_height`: al desplegar una sección el menú crece hasta el alto disponible (si no,
    // se quedaba del alto de antes).
    egui::ScrollArea::vertical().max_height(max_h).min_scrolled_height(max_h).show(ui, |ui| {
        // Un renglón con su acción (macro: `act` también se escribe en los demás renglones).
        macro_rules! a {
            ($ui:expr, $label:expr, $k:expr, $m:expr) => {
                if item($ui, $label, $k) {
                    act = Some($m);
                }
            };
        }
        a!(ui, "Iurefficient", Some(&IURE), MenuAct::Side(SideTab::Iurefficient));
        a!(ui, pick("Assistant", "Asistente"), Some(&ASSIST), MenuAct::Side(SideTab::Assistant));
        ui.separator();
        egui::CollapsingHeader::new(pick("File", "Archivo")).default_open(true).show(ui, |ui| {
            a!(ui, pick("New", "Nuevo"), Some(&NEW), MenuAct::New);
            a!(ui, pick("Open…", "Abrir…"), Some(&OPEN), MenuAct::Open);
            a!(ui, pick("Open folder…", "Abrir carpeta…"), None, MenuAct::OpenFolder);
            a!(ui, pick("Go to note…", "Ir a nota…"), Some(&QUICK), MenuAct::QuickSwitcher);
            ui.menu_button(pick("New from template", "Nueva desde plantilla"), |ui| {
                for t in st.templates {
                    if item(ui, t, None) {
                        act = Some(MenuAct::FromTemplate(t.clone()));
                        ui.close();
                    }
                }
                ui.separator();
                if item(ui, pick("Open templates folder…", "Abrir carpeta de plantillas…"), None) {
                    act = Some(MenuAct::OpenTemplatesFolder);
                    ui.close();
                }
            });
            ui.add_enabled_ui(!st.recent.is_empty(), |ui| {
                ui.menu_button(pick("Recent", "Recientes"), |ui| {
                    for p in st.recent {
                        let name =
                            p.file_name().map_or_else(|| p.display().to_string(), |n| n.to_string_lossy().into());
                        let r = item(ui, &name, None);
                        if r {
                            act = Some(MenuAct::OpenRecent(p.clone()));
                            ui.close();
                        }
                    }
                });
            });
            ui.separator();
            a!(ui, pick("Save", "Guardar"), Some(&SAVE), MenuAct::Save);
            a!(ui, pick("Save as…", "Guardar como…"), Some(&SAVE_AS), MenuAct::SaveAs);
            a!(ui, pick("Export to PDF…", "Exportar a PDF…"), None, MenuAct::Export(Format::Pdf));
            a!(ui, pick("Export to DOCX…", "Exportar a DOCX…"), None, MenuAct::Export(Format::Docx));
            a!(ui, pick("Export to HTML…", "Exportar a HTML…"), None, MenuAct::Export(Format::Html));
            ui.separator();
            a!(ui, pick("Close tab", "Cerrar pestaña"), Some(&CLOSE), MenuAct::CloseTab);
            a!(ui, pick("Quit", "Salir"), Some(&QUIT), MenuAct::Quit);
        });
        egui::CollapsingHeader::new(pick("Edit", "Edición")).default_open(false).show(ui, |ui| {
            a!(ui, pick("Undo", "Deshacer"), Some(&UNDO), MenuAct::Undo);
            a!(ui, pick("Redo", "Rehacer"), Some(&REDO), MenuAct::Redo);
            ui.separator();
            a!(ui, pick("Find…", "Buscar…"), Some(&FIND), MenuAct::Find);
            a!(ui, pick("Replace…", "Reemplazar…"), Some(&REPLACE), MenuAct::Replace);
            a!(ui, pick("Go to line…", "Ir a línea…"), Some(&GOTO_LINE), MenuAct::GotoLine);
            ui.separator();
            a!(ui, pick("Insert table of contents", "Insertar índice"), None, MenuAct::InsertToc);
            a!(ui, pick("Command palette…", "Paleta de comandos…"), Some(&PALETTE), MenuAct::CommandPalette);
            a!(ui, pick("Select all", "Seleccionar todo"), Some(&SELECT_ALL), MenuAct::SelectAll);
        });
        egui::CollapsingHeader::new(pick("View", "Ver")).default_open(false).show(ui, |ui| {
            a!(ui, pick("Folder files", "Archivos de la carpeta"), Some(&FILES), MenuAct::Side(SideTab::Files));
            a!(ui, pick("Search in files", "Buscar en archivos"), Some(&FIND_ALL), MenuAct::FindInFiles);
            a!(ui, pick("Document outline", "Esquema del documento"), Some(&OUTLINE), MenuAct::Side(SideTab::Outline));
            a!(ui, pick("Note links", "Enlaces de la nota"), Some(&LINKS), MenuAct::Side(SideTab::Links));
            if item_checked_key(ui, pick("Source code", "Código fuente"), st.source, Some(&SOURCE)) {
                act = Some(MenuAct::SourceCode);
            }
            if item_checked_key(ui, pick("Line numbers", "Números de línea"), st.line_numbers, Some(&LINE_NUMBERS)) {
                act = Some(MenuAct::LineNumbers);
            }
            ui.separator();
            a!(ui, pick("Zoom in", "Aumentar zoom"), Some(&crate::app::ZOOM_IN), MenuAct::ZoomIn);
            a!(ui, pick("Zoom out", "Reducir zoom"), Some(&crate::app::ZOOM_OUT), MenuAct::ZoomOut);
            a!(ui, pick("Reset zoom", "Zoom normal"), Some(&crate::app::ZOOM_RESET), MenuAct::ZoomReset);
            ui.separator();
            heading(ui, pick("PAGE WIDTH", "ANCHO DE PÁGINA"), Some(&PAGE_WIDTH));
            use crate::drafts::PageWidth;
            for (w, label) in [
                (PageWidth::Medium, pick("Medium", "Medio")),
                (PageWidth::Wide, pick("Wide", "Ancho")),
                (PageWidth::Full, pick("Full", "Completo")),
            ] {
                if item_checked(ui, label, st.page == w) {
                    act = Some(MenuAct::PageWidth(w));
                }
            }
            ui.separator();
            heading(ui, pick("THEME", "TEMA"), None);
            use iurefficient_ui::theme::ThemeMode;
            for (mode, label) in [
                (ThemeMode::Light, pick("Light", "Claro")),
                (ThemeMode::Dark, pick("Dark", "Oscuro")),
                (ThemeMode::System, pick("System", "Sistema")),
            ] {
                if item_checked(ui, label, st.theme == mode) {
                    act = Some(MenuAct::Theme(mode));
                }
            }
            ui.separator();
            if item_checked(ui, pick("Spell checker", "Corrector ortográfico"), st.spell) {
                act = Some(MenuAct::Spellcheck(!st.spell));
            }
            ui.separator();
            heading(ui, "LANGUAGE / IDIOMA", None);
            use crate::drafts::LangPref;
            for (l, label) in [
                (LangPref::Auto, pick("Automatic", "Automático")),
                (LangPref::En, "English"),
                (LangPref::Es, "Español"),
            ] {
                if item_checked(ui, label, st.lang == l) {
                    act = Some(MenuAct::Language(l));
                }
            }
            ui.separator();
            heading(ui, pick("APPEARANCE", "APARIENCIA"), None);
            if let Some(m) = appearance(ui, st.look) {
                act = Some(m);
            }
        });
        egui::CollapsingHeader::new(pick("Help", "Ayuda")).default_open(false).show(ui, |ui| {
            a!(ui, pick("IureEditor help", "Ayuda de IureEditor"), Some(&HELP), MenuAct::Help);
            ui.separator();
            for (en, es, url) in crate::help::LINKS {
                a!(ui, pick(en, es), None, MenuAct::Url(url));
            }
            ui.separator();
            a!(ui, pick("Check for updates…", "Buscar actualizaciones…"), None, MenuAct::CheckUpdates);
            a!(ui, pick("About IureEditor", "Acerca de IureEditor"), None, MenuAct::About);
            ui.add_space(2.0);
            ui.label(
                RichText::new(format!("{} {}", pick("Version", "Versión"), env!("CARGO_PKG_VERSION")))
                    .small()
                    .color(theme::colors(ui).text_muted),
            );
        });
    });
    act
}

/// Título de un grupo del menú (en versalitas, como la 1.x), con su atajo a la derecha.
fn heading(ui: &mut Ui, label: &str, shortcut: Option<&KeyboardShortcut>) {
    let c = theme::colors(ui);
    ui.horizontal(|ui| {
        ui.add_space(10.0);
        ui.label(RichText::new(label).small().color(c.text_muted));
        if let Some(k) = shortcut {
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                ui.add_space(10.0);
                ui.label(RichText::new(ui.ctx().format_shortcut(k)).small().color(c.text_muted));
            });
        }
    });
}

/// Fuente, tamaño del texto, densidad y nitidez (como Preferencias › Apariencia de IureDesk).
fn appearance(ui: &mut Ui, look: &crate::drafts::Appearance) -> Option<MenuAct> {
    let mut act = None;
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
            let look = app.look.clone();
            let recent = app.recent.clone();
            let templates = app.template_names();
            let st = MenuState {
                theme: app.theme,
                look: &look,
                page: app.page,
                spell: app.spell_on,
                source: app.source,
                line_numbers: app.line_numbers,
                lang: app.lang,
                recent: &recent,
                templates: &templates,
            };
            // Desplegar Archivo, Edición, Ver o Ayuda no cierra el menú; elegir algo, sí.
            egui::Popup::menu(&m).close_behavior(egui::PopupCloseBehavior::CloseOnClickOutside).show(|ui| {
                if let Some(a) = menu(ui, &st) {
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
