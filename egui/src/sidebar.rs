//! Panel lateral, como IureEditor 1.x: **Archivos** (los Markdown de la carpeta del documento o de
//! la que se abra), **Buscar** (texto en esos archivos) y **Esquema** (los títulos del documento,
//! con el actual resaltado). Un clic abre el archivo o lleva el cursor al lugar.
//!
//! Lo que se lee del disco va acotado (profundidad, número y tamaño de archivos) y la búsqueda
//! corre en otro hilo.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};

use egui::{RichText, Sense, Ui, vec2};
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
}

#[derive(Default)]
pub(crate) struct Sidebar {
    pub open: bool,
    pub tab: SideTab,
    /// Carpeta abierta con «Abrir carpeta…» (si no, la del documento).
    pub root: Option<PathBuf>,
    files: Option<(PathBuf, Vec<PathBuf>, f64)>,
    pub query: String,
    pub results: Vec<Hit>,
    searched: String,
    searching: Option<Receiver<Vec<Hit>>>,
    pub picking: Option<Receiver<Option<PathBuf>>>,
    /// Pedir el foco del campo de búsqueda (Ctrl+Mayús+F).
    pub focus_search: bool,
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
fn row(ui: &mut Ui, text: &str, indent: f32, selected: bool, muted: bool) -> egui::Response {
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
    ) -> Option<SideAct> {
        let ctx = ui.ctx().clone();
        let c = theme::colors(ui);
        let mut act = None;
        let frame = egui::Frame::new().fill(c.surface_alt).inner_margin(egui::Margin::symmetric(6, 6));
        egui::Panel::left("iureditor-side")
            .frame(frame)
            .resizable(true)
            .default_size(250.0)
            .size_range(180.0..=480.0)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    for (t, label) in [
                        (SideTab::Files, pick("Files", "Archivos")),
                        (SideTab::Search, pick("Search", "Buscar")),
                        (SideTab::Outline, pick("Outline", "Esquema")),
                    ] {
                        let on = self.tab == t;
                        let r = ui
                            .selectable_label(on, RichText::new(label).color(if on { c.accent } else { c.text_muted }));
                        if r.clicked() {
                            self.tab = t;
                        }
                    }
                });
                ui.separator();
                let folder = self.folder(doc);
                match self.tab {
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
                        if ui.button(pick("Open folder…", "Abrir carpeta…")).clicked() {
                            act = Some(SideAct::PickFolder);
                        }
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
                        let now = ctx.input(|i| i.time);
                        // La lista se renueva cada pocos segundos (archivos nuevos o borrados).
                        let stale = self.files.as_ref().is_none_or(|(r, _, t)| *r != root || now - t > 5.0);
                        if stale {
                            self.files = Some((root.clone(), list_docs(&root), now));
                        }
                        ui.label(
                            RichText::new(
                                root.file_name()
                                    .map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned()),
                            )
                            .strong()
                            .color(c.text),
                        );
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
                                if row(ui, &shown, 0.0, selected, false).clicked() {
                                    act = Some(SideAct::Open(p.clone(), None));
                                }
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
