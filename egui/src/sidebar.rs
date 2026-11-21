//! Panel lateral, como IureEditor 1.x: **Archivos** (los Markdown de la carpeta del documento o de
//! la que se abra; con la lupa, **Buscar** texto en esos archivos), **Esquema** (los títulos del
//! documento, con el actual resaltado) e **Iurefficient** (`crate::iure`). Un clic abre el archivo
//! o lleva el cursor al lugar.
//!
//! Lo que se lee del disco va acotado (profundidad, número y tamaño de archivos) y la búsqueda
//! corre en otro hilo.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};

use egui::{RichText, Sense, Ui, vec2};
use iurefficient_ui::icons::{self, Icon};
use iurefficient_ui::{pick, theme};

/// Archivos que se listan como mucho.
const MAX_FILES: usize = 2_000;
/// Profundidad de carpetas.
const MAX_DEPTH: usize = 6;
/// Archivo más grande en el que se busca.
const MAX_SEARCH_BYTES: u64 = 4 * 1024 * 1024;
/// Resultados de búsqueda como mucho.
const MAX_HITS: usize = 500;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum SideTab {
    Files,
    Search,
    #[default]
    Outline,
    Links,
    Iurefficient,
    Assistant,
}

/// Un resultado de búsqueda: archivo, línea (desde 1), carácter donde empieza y el renglón.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Hit {
    pub path: PathBuf,
    pub line: usize,
    pub offset: usize,
    pub snippet: String,
}

/// Lo que pide el panel (lo hace la app).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum SideAct {
    /// Abrir un archivo y, si se da, llevar el cursor a ese carácter.
    Open(PathBuf, Option<usize>),
    /// Llevar el cursor a este carácter del documento activo.
    Goto(usize),
    /// Elegir una carpeta.
    PickFolder,
    /// Se renombró un archivo (si está abierto, la pestaña sigue al nombre nuevo).
    Renamed(PathBuf, PathBuf),
    /// Seguir un enlace `[[…]]` (abrir o crear la nota).
    Follow(String),
    /// Lo que pide el asistente.
    Assist(crate::assistant::AssistAct),
    /// Lo que pide la pestaña Iurefficient.
    Iure(crate::iure::IureAct),
}

#[derive(Default)]
pub(crate) struct Sidebar {
    pub open: bool,
    pub tab: SideTab,
    /// Carpeta abierta con «Abrir carpeta…» (si no, la del documento).
    pub root: Option<PathBuf>,
    files: Option<(PathBuf, Vec<PathBuf>, f64)>,
    /// La lista que se está leyendo en otro hilo (carpeta, resultado): recorrer una carpeta grande
    /// en el hilo de la interfaz la detenía un momento cada pocos segundos.
    listing: Option<(PathBuf, Receiver<Vec<PathBuf>>)>,
    pub query: String,
    pub results: Vec<Hit>,
    searched: String,
    searching: Option<Receiver<Vec<Hit>>>,
    pub picking: Option<Receiver<Option<PathBuf>>>,
    /// Pedir el foco del campo de búsqueda (Ctrl+Mayús+F).
    pub focus_search: bool,
    /// La pestaña Iurefficient (conexión, proyectos, espejos).
    pub iure: crate::iure::IurePanel,
    /// La pestaña Enlaces.
    links: crate::backlinks::LinksPanel,
    /// La pestaña Asistente.
    pub assistant: crate::assistant::Assistant,
    /// Nombre que se está escribiendo (archivo o carpeta nuevos, renombrar).
    pub naming: Option<Naming>,
    name_error: Option<String>,
}

/// El campo de nombre del panel de archivos.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Naming {
    File(String),
    Folder(String),
    /// Archivo y nombre nuevo (sin la extensión).
    Rename(PathBuf, String),
}

/// Por qué no se pudo crear o renombrar.
fn name_problem(name: &str) -> Option<&'static str> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." || n.contains(['/', '\\']) || n.chars().any(char::is_control) {
        Some(pick("Invalid name.", "Nombre no válido."))
    } else {
        None
    }
}

/// Crea un archivo (`.md` si no lleva extensión) o una carpeta en `dir`. Devuelve la ruta.
pub(crate) fn create(dir: &Path, name: &str, folder: bool) -> Result<PathBuf, String> {
    if let Some(p) = name_problem(name) {
        return Err(p.to_string());
    }
    let n = name.trim();
    let mut path = dir.join(n);
    if !folder && path.extension().is_none() {
        path.set_extension("md");
    }
    if path.exists() {
        return Err(pick("A file with that name already exists.", "Ya existe un archivo con ese nombre.").to_string());
    }
    let r = if folder {
        std::fs::create_dir(&path)
    } else {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&path).map(|_| ())
    };
    r.map(|()| path).map_err(|e| e.to_string())
}

/// Renombra un archivo conservando su extensión si el nombre nuevo no trae una.
pub(crate) fn rename(from: &Path, name: &str) -> Result<PathBuf, String> {
    if let Some(p) = name_problem(name) {
        return Err(p.to_string());
    }
    let mut to = from.with_file_name(name.trim());
    if to.extension().is_none()
        && let Some(ext) = from.extension()
    {
        to.set_extension(ext);
    }
    if to == from {
        return Ok(to);
    }
    if to.exists() {
        return Err(pick("A file with that name already exists.", "Ya existe un archivo con ese nombre.").to_string());
    }
    std::fs::rename(from, &to).map(|()| to).map_err(|e| e.to_string())
}

/// Títulos de un Markdown: (nivel, texto, carácter donde empieza la línea). Sin los de dentro de
/// bloques de código.
pub(crate) fn outline(text: &str) -> Vec<(u8, String, usize)> {
    let mut out = Vec::new();
    let mut fence: Option<char> = None;
    let mut at = 0usize;
    for line in text.split('\n').take(200_000) {
        let t = line.trim_start();
        if let Some(f) = fence {
            if t.starts_with(&f.to_string().repeat(3)) {
                fence = None;
            }
        } else if t.starts_with("```") || t.starts_with("~~~") {
            fence = t.chars().next();
        } else {
            let hashes = t.chars().take_while(|c| *c == '#').count();
            if (1..=6).contains(&hashes) && t.chars().nth(hashes).is_some_and(|c| c == ' ') && line.len() - t.len() < 4
            {
                let title: String = t
                    .get(hashes..)
                    .unwrap_or("")
                    .trim()
                    .trim_end_matches('#')
                    .trim()
                    .chars()
                    .filter(|c| !matches!(c, '*' | '_' | '`'))
                    .take(200)
                    .collect();
                if !title.is_empty() && out.len() < 2_000 {
                    out.push((hashes as u8, title, at));
                }
            }
        }
        at += line.chars().count() + 1;
    }
    out
}

fn is_doc(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|e| matches!(e.as_str(), "md" | "markdown" | "txt"))
}

/// Los documentos de una carpeta (y sus subcarpetas), ordenados, sin carpetas ocultas ni de
/// compilación.
pub(crate) fn list_docs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten().take(10_000) {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < MAX_DEPTH && !matches!(name.as_str(), "node_modules" | "target" | "dist" | "build") {
                    stack.push((p, depth + 1));
                }
            } else if ft.is_file() && is_doc(&p) {
                out.push(p);
                if out.len() >= MAX_FILES {
                    out.sort();
                    return out;
                }
            }
        }
    }
    out.sort();
    out
}

/// Busca `query` (sin distinguir mayúsculas) en los documentos de `root`.
pub(crate) fn search(root: &Path, query: &str) -> Vec<Hit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for path in list_docs(root) {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        if meta.len() > MAX_SEARCH_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        let mut at = 0usize;
        for (i, line) in text.split('\n').enumerate() {
            if line.to_lowercase().contains(&q) {
                hits.push(Hit {
                    path: path.clone(),
                    line: i + 1,
                    offset: at,
                    snippet: line.trim().chars().take(120).collect(),
                });
                if hits.len() >= MAX_HITS {
                    return hits;
                }
            }
            at += line.chars().count() + 1;
        }
    }
    hits
}

/// Un renglón del panel que se puede pulsar.
pub(crate) fn row(ui: &mut Ui, text: &str, indent: f32, selected: bool, muted: bool) -> egui::Response {
    let c = theme::colors(ui);
    let w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(vec2(w, 26.0), Sense::click());
    if selected {
        ui.painter().rect_filled(rect, 4.0, c.selection_inactive);
        ui.painter().rect_filled(egui::Rect::from_min_size(rect.min, vec2(3.0, rect.height())), 1.0, c.accent);
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, 4.0, c.hover);
    }
    let ink = if selected {
        c.accent
    } else if muted {
        c.text_muted
    } else {
        c.text
    };
    let g = iurefficient_ui::widgets::text::elided(ui, text, theme::body_font(ui.ctx()), ink, w - indent - 12.0);
    ui.painter().galley(egui::pos2(rect.left() + 10.0 + indent, rect.center().y - g.size().y / 2.0), g, ink);
    iurefficient_ui::a11y::row(&resp, text, selected);
    resp
}

impl Sidebar {
    /// La cabecera de Archivos: nombre de la carpeta y sus acciones (como la 1.x).
    fn files_header(&mut self, ui: &mut Ui, root: &Path) -> Option<SideAct> {
        let c = theme::colors(ui);
        let mut act = None;
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 0.0;
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if icons::icon_button(ui, Icon::Open, pick("Change folder", "Cambiar carpeta"), true).clicked() {
                    act = Some(SideAct::PickFolder);
                }
                if icons::icon_button(ui, Icon::Sync, pick("Reload", "Recargar"), true).clicked() {
                    self.files = None;
                }
                let up = root.parent().map(Path::to_path_buf);
                if icons::icon_button(ui, Icon::MoveUp, pick("Go up a directory", "Subir un directorio"), up.is_some())
                    .clicked()
                {
                    self.root = up;
                    self.files = None;
                }
                if icons::icon_button(ui, Icon::Folder, pick("New folder", "Nueva carpeta"), true).clicked() {
                    self.naming = Some(Naming::Folder(String::new()));
                    self.name_error = None;
                }
                if icons::icon_button(ui, Icon::New, pick("New file", "Nuevo archivo"), true).clicked() {
                    self.naming = Some(Naming::File(String::new()));
                    self.name_error = None;
                }
                if icons::icon_button(
                    ui,
                    Icon::Search,
                    pick("Search in files (Ctrl+Shift+F)", "Buscar en archivos (Ctrl+Shift+F)"),
                    true,
                )
                .clicked()
                {
                    self.tab = SideTab::Search;
                    self.focus_search = true;
                }
            });
        });
        let name = root.file_name().map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned());
        ui.add(egui::Label::new(RichText::new(name.to_uppercase()).small().color(c.text_muted)).truncate())
            .on_hover_text(root.display().to_string());
        act
    }

    /// El campo para el nombre nuevo: Intro crea o renombra; Esc cancela. Con error se queda abierto.
    fn name_field(&mut self, ui: &mut Ui, root: &Path) -> Option<SideAct> {
        let mut naming = self.naming.take()?;
        let (hint, buf) = match &mut naming {
            Naming::File(b) => (pick("name.md", "nombre.md"), b),
            Naming::Folder(b) => (pick("name", "nombre"), b),
            Naming::Rename(_, b) => (pick("new name", "nombre nuevo"), b),
        };
        let r = ui.add(egui::TextEdit::singleline(buf).hint_text(hint).desired_width(f32::INFINITY));
        r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, hint));
        if !r.has_focus() && !r.lost_focus() {
            r.request_focus();
        }
        let (enter, esc) = ui.input(|i| (i.key_pressed(egui::Key::Enter), i.key_pressed(egui::Key::Escape)));
        if let Some(e) = &self.name_error {
            ui.label(RichText::new(e).small().color(ui.visuals().error_fg_color));
        }
        if esc {
            self.name_error = None;
            return None;
        }
        if !(r.lost_focus() && enter) {
            self.naming = Some(naming);
            return None;
        }
        let done = match &naming {
            Naming::File(n) => create(root, n, false).map(|p| Some(SideAct::Open(p, None))),
            Naming::Folder(n) => create(root, n, true).map(|_| None),
            Naming::Rename(from, n) => rename(from, n).map(|to| Some(SideAct::Renamed(from.clone(), to))),
        };
        self.files = None;
        match done {
            Ok(a) => {
                self.name_error = None;
                a
            }
            Err(e) => {
                self.name_error = Some(e);
                self.naming = Some(naming);
                None
            }
        }
    }

    /// Abierto, en el esquema.
    pub(crate) fn new_open() -> Self {
        Sidebar { open: true, ..Default::default() }
    }

    /// La carpeta que se muestra: la abierta o la del documento.
    pub(crate) fn folder(&self, doc: Option<&Path>) -> Option<PathBuf> {
        self.root.clone().or_else(|| doc.and_then(Path::parent).map(Path::to_path_buf))
    }

    /// Recoge la búsqueda o la carpeta elegida, si llegaron.
    pub(crate) fn poll(&mut self) {
        if let Some(rx) = &self.searching
            && let Ok(r) = rx.try_recv()
        {
            self.results = r;
            self.searching = None;
        }
        if let Some(rx) = &self.picking
            && let Ok(choice) = rx.try_recv()
        {
            self.picking = None;
            if let Some(p) = choice {
                self.root = Some(p);
                self.files = None;
                self.tab = SideTab::Files;
            }
        }
    }

    fn start_search(&mut self, ctx: &egui::Context, root: PathBuf) {
        let q = self.query.clone();
        self.searched = q.clone();
        let (tx, rx) = channel();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(search(&root, &q));
            ctx.request_repaint();
        });
        self.searching = Some(rx);
    }

    /// El panel. `doc`: archivo del documento activo; `text` y `caret`: su texto y el cursor.
    pub(crate) fn show(
        &mut self,
        ui: &mut Ui,
        doc: Option<&Path>,
        text: &str,
        caret: Option<usize>,
        notes: Option<&crate::notes::FolderNotes>,
        selection: Option<&str>,
    ) -> Option<SideAct> {
        let ctx = ui.ctx().clone();
        let c = theme::colors(ui);
        let mut act = None;
        let frame = egui::Frame::new().fill(c.surface_alt).inner_margin(egui::Margin::symmetric(6, 6));
        egui::Panel::left("iureditor-side")
            .frame(frame)
            .resizable(true)
            .default_size(288.0)
            .size_range(180.0..=480.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 0.0;
                    ui.spacing_mut().button_padding.x = 6.0;
                    for (t, label) in [
                        (SideTab::Files, pick("Files", "Archivos")),
                        (SideTab::Outline, pick("Outline", "Esquema")),
                        (SideTab::Links, pick("Links", "Enlaces")),
                        (SideTab::Iurefficient, "Iurefficient"),
                    ] {
                        // «Buscar» vive dentro de Archivos (la lupa), como en la 1.x.
                        let on = self.tab == t || (t == SideTab::Files && self.tab == SideTab::Search);
                        let r = ui
                            .selectable_label(on, RichText::new(label).color(if on { c.accent } else { c.text_muted }));
                        if r.clicked() {
                            self.tab = t;
                        }
                    }
                    // El asistente, solo con su icono (como la 1.x).
                    let on = self.tab == SideTab::Assistant;
                    let side = theme::density(ui.ctx()).icon_size();
                    let r = ui
                        .add(egui::Button::selectable(
                            on,
                            egui::Atom::custom(egui::IdSalt::new("asistente"), vec2(side, side)),
                        ))
                        .on_hover_text(pick("Assistant", "Asistente"));
                    let ir = egui::Rect::from_center_size(r.rect.center(), vec2(side, side));
                    icons::paint(ui.painter(), ir, Icon::Sparkle, if on { c.accent } else { c.text_muted }, c.accent);
                    iurefficient_ui::a11y::button(&r, pick("Assistant", "Asistente"));
                    if r.clicked() {
                        self.tab = SideTab::Assistant;
                    }
                });
                ui.separator();
                let folder = self.folder(doc);
                match self.tab {
                    SideTab::Links => match self.links.show(ui, doc, text, notes) {
                        Some(crate::backlinks::LinkAct::Open(p, at)) => act = Some(SideAct::Open(p, Some(at))),
                        Some(crate::backlinks::LinkAct::Follow(l)) => act = Some(SideAct::Follow(l)),
                        None => {}
                    },
                    SideTab::Assistant => {
                        if let Some(a) = self.assistant.show(ui, &mut self.iure, doc, text, selection) {
                            act = Some(SideAct::Assist(a));
                        }
                    }
                    SideTab::Iurefficient => {
                        if let Some(a) = self.iure.show(ui, doc) {
                            act = Some(SideAct::Iure(a));
                        }
                    }
                    SideTab::Outline => {
                        let heads = outline(text);
                        if heads.is_empty() {
                            ui.label(
                                RichText::new(pick(
                                    "No headings in this document.",
                                    "Este documento no tiene títulos.",
                                ))
                                .color(c.text_muted),
                            );
                        }
                        // El título en el que está el cursor.
                        let current = caret.and_then(|cu| heads.iter().rposition(|(_, _, at)| *at <= cu));
                        let min = heads.iter().map(|(l, _, _)| *l).min().unwrap_or(1);
                        egui::ScrollArea::vertical().id_salt("side-outline").show(ui, |ui| {
                            for (k, (level, title, at)) in heads.iter().enumerate() {
                                let indent = f32::from(level.saturating_sub(min)) * 14.0;
                                if row(ui, title, indent, current == Some(k), false).clicked() {
                                    act = Some(SideAct::Goto(*at));
                                }
                            }
                        });
                    }
                    SideTab::Files => {
                        let Some(root) = folder else {
                            ui.vertical_centered(|ui| {
                                ui.add_space(12.0);
                                ui.label(
                                    RichText::new(pick("No workspace folder", "Sin carpeta de trabajo"))
                                        .color(c.text_muted),
                                );
                                if ui.button(pick("Open folder…", "Abrir carpeta…")).clicked() {
                                    act = Some(SideAct::PickFolder);
                                }
                            });
                            return;
                        };
                        let now = ctx.input(|i| i.time);
                        // La lista se renueva cada pocos segundos (archivos nuevos o borrados).
                        if let Some((r, rx)) = self.listing.as_ref()
                            && let Ok(list) = rx.try_recv()
                        {
                            self.files = Some((r.clone(), list, now));
                            self.listing = None;
                        }
                        let stale = self.files.as_ref().is_none_or(|(r, _, t)| *r != root || now - t > 5.0);
                        if stale && self.listing.as_ref().is_none_or(|(r, _)| *r != root) {
                            let (tx, rx) = std::sync::mpsc::channel();
                            let dir = root.clone();
                            std::thread::spawn(move || {
                                let _ = tx.send(list_docs(&dir));
                            });
                            self.listing = Some((root.clone(), rx));
                        }
                        if self.listing.is_some() {
                            ctx.request_repaint_after(std::time::Duration::from_millis(50));
                        }
                        // Otra carpeta: no se muestra la lista de la anterior mientras llega la nueva.
                        if self.files.as_ref().is_some_and(|(r, _, _)| *r != root) {
                            self.files = None;
                        }
                        if let Some(a) = self.files_header(ui, &root) {
                            act = Some(a);
                        }
                        if let Some(a) = self.name_field(ui, &root) {
                            act = Some(a);
                        }
                        egui::ScrollArea::vertical().id_salt("side-files").show(ui, |ui| {
                            let files = self.files.as_ref().map(|(_, f, _)| f.clone()).unwrap_or_default();
                            if files.is_empty() {
                                ui.label(
                                    RichText::new(pick(
                                        "No Markdown documents here.",
                                        "Aquí no hay documentos Markdown.",
                                    ))
                                    .color(c.text_muted),
                                );
                            }
                            for p in files {
                                let rel = p.strip_prefix(&root).unwrap_or(&p);
                                let depth = rel.components().count().saturating_sub(1) as f32;
                                let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                                let shown = if depth > 0.0 { rel.display().to_string() } else { name };
                                let selected = doc.is_some_and(|d| d == p);
                                let r = row(ui, &shown, 0.0, selected, false);
                                if r.clicked() {
                                    act = Some(SideAct::Open(p.clone(), None));
                                }
                                r.context_menu(|ui| {
                                    if ui.button(pick("Rename…", "Renombrar…")).clicked() {
                                        let stem =
                                            p.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                                        self.naming = Some(Naming::Rename(p.clone(), stem));
                                        self.name_error = None;
                                        ui.close();
                                    }
                                    ui.separator();
                                    if ui.button(pick("New file", "Nuevo archivo")).clicked() {
                                        self.naming = Some(Naming::File(String::new()));
                                        ui.close();
                                    }
                                    if ui.button(pick("New folder", "Nueva carpeta")).clicked() {
                                        self.naming = Some(Naming::Folder(String::new()));
                                        ui.close();
                                    }
                                    if ui.button(pick("Reload", "Recargar")).clicked() {
                                        self.files = None;
                                        ui.close();
                                    }
                                });
                            }
                        });
                    }
                    SideTab::Search => {
                        let Some(root) = folder else {
                            ui.label(
                                RichText::new(pick(
                                    "Save the document or open a folder.",
                                    "Guarda el documento o abre una carpeta.",
                                ))
                                .color(c.text_muted),
                            );
                            return;
                        };
                        ui.horizontal(|ui| {
                            if icons::icon_button(ui, Icon::Back, pick("Back to files", "Volver a los archivos"), true)
                                .clicked()
                            {
                                self.tab = SideTab::Files;
                            }
                            ui.label(
                                RichText::new(pick("Search in files", "Buscar en archivos")).strong().color(c.text),
                            );
                        });
                        let field = ui.add(
                            egui::TextEdit::singleline(&mut self.query)
                                .hint_text(pick("Search in the folder…", "Buscar en la carpeta…"))
                                .desired_width(f32::INFINITY),
                        );
                        if std::mem::take(&mut self.focus_search) {
                            field.request_focus();
                        }
                        let enter = field.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
                        if enter && !self.query.trim().is_empty() {
                            self.start_search(&ctx, root.clone());
                        }
                        if self.searching.is_some() {
                            ui.horizontal(|ui| {
                                ui.add(egui::Spinner::new().size(12.0));
                                ui.label(RichText::new(pick("Searching…", "Buscando…")).color(c.text_muted));
                            });
                        } else if !self.searched.is_empty() {
                            let n = self.results.len();
                            let more = if n >= MAX_HITS { "+" } else { "" };
                            ui.label(
                                RichText::new(format!("{n}{more} {}", pick("results", "resultados")))
                                    .small()
                                    .color(c.text_muted),
                            );
                        }
                        egui::ScrollArea::vertical().id_salt("side-search").show(ui, |ui| {
                            let mut last: Option<&Path> = None;
                            for h in &self.results {
                                if last != Some(h.path.as_path()) {
                                    let rel = h.path.strip_prefix(&root).unwrap_or(&h.path);
                                    ui.add_space(4.0);
                                    ui.label(RichText::new(rel.display().to_string()).strong().small().color(c.text));
                                    last = Some(h.path.as_path());
                                }
                                if row(ui, &format!("{}  {}", h.line, h.snippet), 6.0, false, true).clicked() {
                                    act = Some(SideAct::Open(h.path.clone(), Some(h.offset)));
                                }
                            }
                        });
                    }
                }
            });
        act
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outline_skips_code_and_cleans_titles() {
        let t = "# Uno\n\ntexto\n\n## **Dos** ##\n\n```\n# no es título\n```\n\n   ### Tres\n#sin espacio\n";
        let o = outline(t);
        let titles: Vec<&str> = o.iter().map(|(_, s, _)| s.as_str()).collect();
        assert_eq!(titles, ["Uno", "Dos", "Tres"]);
        assert_eq!(o.first().map(|x| x.0), Some(1));
        // El carácter donde empieza la línea de «Dos».
        assert_eq!(o.get(1).map(|x| x.2), Some("# Uno\n\ntexto\n\n".chars().count()));
    }

    #[test]
    fn new_files_get_md_and_names_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let f = create(dir.path(), "Notas", false).unwrap();
        assert_eq!(f, dir.path().join("Notas.md"));
        assert!(create(dir.path(), "Notas.md", false).is_err(), "ya existe");
        assert!(create(dir.path(), "a/b", false).is_err());
        assert!(create(dir.path(), "  ", true).is_err());
        assert!(create(dir.path(), "..", true).is_err());
        assert!(create(dir.path(), "Actas", true).unwrap().is_dir());
        let r = rename(&f, "Acuerdos").unwrap();
        assert_eq!(r, dir.path().join("Acuerdos.md"), "conserva la extensión");
        assert!(r.is_file() && !f.exists());
        std::fs::write(dir.path().join("otro.md"), "").unwrap();
        assert!(rename(&r, "otro").is_err(), "no pisa otro archivo");
    }

    #[test]
    fn lists_and_searches_documents_in_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "# A\nla Audiencia es el lunes\n").unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.markdown"), "nada\notra AUDIENCIA\n").unwrap();
        std::fs::write(dir.path().join("foto.png"), b"x").unwrap();
        std::fs::create_dir_all(dir.path().join(".git")).unwrap();
        std::fs::write(dir.path().join(".git/c.md"), "audiencia").unwrap();
        let files = list_docs(dir.path());
        assert_eq!(files.len(), 2, "{files:?}");
        let hits = search(dir.path(), "audiencia");
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].line, hits[0].offset), (2, 4));
        assert_eq!(hits[1].line, 2);
        assert!(search(dir.path(), "   ").is_empty());
    }
}
