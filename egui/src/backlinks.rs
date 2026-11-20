//! Pestaña **Enlaces** del panel lateral, como IureEditor 1.x: los enlaces **entrantes** (notas de
//! la carpeta que enlazan a este documento con `[[…]]` o `[texto](archivo.md)`), los **salientes**
//! (los `[[…]]` del documento, con los que aún no existen en gris) y las **menciones sin enlazar**
//! (notas que nombran el documento sin enlazarlo).
//!
//! La carpeta se lee en otro hilo, acotada (archivos, tamaño, resultados).

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};

use egui::{RichText, Ui};
use iurefficient_ui::{pick, theme};

/// Archivo más grande que se lee.
const MAX_BYTES: u64 = 4 * 1024 * 1024;
/// Resultados por sección.
const MAX_HITS: usize = 300;
/// Cada cuánto se vuelve a leer la carpeta con la pestaña abierta.
const RESCAN: f64 = 5.0;

/// Una nota que enlaza o menciona el documento: archivo, carácter de la línea y la línea.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Hit {
    pub path: PathBuf,
    pub offset: usize,
    pub line: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Report {
    pub backlinks: Vec<Hit>,
    pub unlinked: Vec<Hit>,
}

/// Sin mayúsculas ni acentos.
fn fold(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c => c,
        })
        .collect()
}

/// Los destinos `[[destino#título|alias]]` de un texto (sin título ni alias), con el byte donde
/// empieza cada uno. Fuera de los bloques de código.
pub(crate) fn wiki_targets(text: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut fence = false;
    let mut at = 0usize;
    for line in text.split_inclusive('\n').take(200_000) {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fence = !fence;
        } else if !fence {
            let mut from = 0usize;
            while let Some(i) = line.get(from..).and_then(|l| l.find("[[")) {
                let s = from + i + 2;
                let Some(len) = line.get(s..).and_then(|l| l.find("]]")) else { break };
                let inner = line.get(s..s + len).unwrap_or("");
                let target = inner.split(['|', '#']).next().unwrap_or("").trim();
                if !target.is_empty() && !inner.contains(['[', ']']) && out.len() < 5_000 {
                    out.push((target.to_string(), at + s - 2));
                }
                from = s + len + 2;
            }
        }
        at += line.len();
    }
    out
}

/// ¿Este destino apunta al documento `stem` (`ruta/Nombre` o `Nombre`)?
fn points_to(target: &str, stem: &str) -> bool {
    let name = target.trim_end_matches(".md").rsplit('/').next().unwrap_or(target);
    fold(name) == fold(stem)
}

/// Busca en `files` quién enlaza o menciona `doc`.
pub(crate) fn scan(files: &[PathBuf], doc: &Path) -> Report {
    let mut r = Report::default();
    let Some(stem) = doc.file_stem().map(|s| s.to_string_lossy().into_owned()) else { return r };
    let file_name = doc.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let stem_f = fold(&stem);
    for p in files.iter().take(10_000) {
        if p == doc || std::fs::metadata(p).map_or(true, |m| m.len() > MAX_BYTES) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(p) else { continue };
        let line_of = |byte: usize| {
            let start = text.get(..byte).and_then(|t| t.rfind('\n')).map_or(0, |i| i + 1);
            let line = text.get(start..).and_then(|t| t.lines().next()).unwrap_or("");
            let offset = text.get(..start).map_or(0, |t| t.chars().count());
            (offset, line.trim().chars().take(140).collect::<String>())
        };
        let mut linked_lines = Vec::new();
        for (target, at) in wiki_targets(&text) {
            if points_to(&target, &stem) && r.backlinks.len() < MAX_HITS {
                let (offset, line) = line_of(at);
                if !linked_lines.contains(&offset) {
                    linked_lines.push(offset);
                    r.backlinks.push(Hit { path: p.clone(), offset, line });
                }
            }
        }
        // `[texto](Nombre.md)`.
        if !file_name.is_empty() {
            let needle = format!("]({file_name}");
            let enc = format!("]({}", file_name.replace(' ', "%20"));
            for n in [needle, enc] {
                let mut from = 0usize;
                while let Some(i) = text.get(from..).and_then(|t| t.find(&n)) {
                    let (offset, line) = line_of(from + i);
                    if !linked_lines.contains(&offset) && r.backlinks.len() < MAX_HITS {
                        linked_lines.push(offset);
                        r.backlinks.push(Hit { path: p.clone(), offset, line });
                    }
                    from += i + n.len();
                }
            }
        }
        // Menciones: el nombre como palabra, en una línea sin enlace a él.
        if stem_f.chars().count() >= 3 {
            let mut at = 0usize;
            let mut fence = false;
            for line in text.split_inclusive('\n') {
                let off = text.get(..at).map_or(0, |t| t.chars().count());
                let tl = line.trim_start();
                if tl.starts_with("```") || tl.starts_with("~~~") {
                    fence = !fence;
                }
                if fence || tl.starts_with("```") || tl.starts_with("~~~") {
                    at += line.len();
                    continue;
                }
                let lf = fold(line);
                let word = lf.match_indices(&stem_f).any(|(i, _)| {
                    let before = lf.get(..i).and_then(|b| b.chars().last());
                    let after = lf.get(i + stem_f.len()..).and_then(|a| a.chars().next());
                    !before.is_some_and(char::is_alphanumeric) && !after.is_some_and(char::is_alphanumeric)
                });
                if word && !linked_lines.contains(&off) && r.unlinked.len() < MAX_HITS {
                    r.unlinked.push(Hit {
                        path: p.clone(),
                        offset: off,
                        line: line.trim().chars().take(140).collect(),
                    });
                }
                at += line.len();
            }
        }
    }
    r
}

/// Lo que pide la pestaña.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum LinkAct {
    /// Abrir esta nota en este carácter.
    Open(PathBuf, usize),
    /// Seguir un `[[…]]` (abrirlo o crearlo).
    Follow(String),
}

#[derive(Default)]
pub(crate) struct LinksPanel {
    report: Option<(PathBuf, Report)>,
    scanning: Option<(PathBuf, Receiver<Report>)>,
    last: f64,
}

impl LinksPanel {
    /// La pestaña. `doc`: el documento activo; `text`, su texto; `notes`, las de su carpeta.
    pub(crate) fn show(
        &mut self,
        ui: &mut Ui,
        doc: Option<&Path>,
        text: &str,
        notes: Option<&crate::notes::FolderNotes>,
    ) -> Option<LinkAct> {
        let c = theme::colors(ui);
        let mut act = None;
        let (Some(doc), Some(notes)) = (doc, notes) else {
            ui.label(
                RichText::new(pick("Save the document to see its links", "Guarda el documento para ver sus enlaces"))
                    .color(c.text_muted),
            );
            return None;
        };
        // Resultado del hilo; y otra lectura cada pocos segundos o al cambiar de documento.
        if let Some((p, rx)) = &self.scanning
            && let Ok(r) = rx.try_recv()
        {
            self.report = Some((p.clone(), r));
            self.scanning = None;
        }
        let now = ui.input(|i| i.time);
        let stale = self.report.as_ref().is_none_or(|(p, _)| p != doc) || now - self.last > RESCAN;
        if stale && self.scanning.is_none() {
            self.last = now;
            let (tx, rx) = channel();
            let files = notes.files();
            let d = doc.to_path_buf();
            let ctx = ui.ctx().clone();
            std::thread::spawn(move || {
                let _ = tx.send(scan(&files, &d));
                ctx.request_repaint();
            });
            self.scanning = Some((doc.to_path_buf(), rx));
        }
        ui.ctx().request_repaint_after(std::time::Duration::from_secs_f64(RESCAN));
        let report = self.report.as_ref().filter(|(p, _)| p == doc).map(|(_, r)| r.clone());
        let header = |ui: &mut Ui, label: &str, n: usize| {
            ui.add_space(6.0);
            ui.label(RichText::new(format!("{}  {n}", label.to_uppercase())).small().color(c.text_muted));
        };
        let none = |ui: &mut Ui| {
            ui.label(RichText::new(pick("None", "Ninguno")).italics().small().color(c.text_muted));
        };
        let root = &notes.root;
        let name = |p: &Path| p.strip_prefix(root).unwrap_or(p).with_extension("").to_string_lossy().into_owned();
        egui::ScrollArea::vertical().id_salt("side-links").show(ui, |ui| {
            match &report {
                None => {
                    ui.label(RichText::new(pick("Indexing notes…", "Indexando notas…")).color(c.text_muted));
                }
                Some(r) => {
                    header(ui, pick("Backlinks", "Enlaces entrantes"), r.backlinks.len());
                    if r.backlinks.is_empty() {
                        none(ui);
                    }
                    for h in &r.backlinks {
                        if hit_row(ui, &name(&h.path), &h.line).clicked() {
                            act = Some(LinkAct::Open(h.path.clone(), h.offset));
                        }
                    }
                }
            }
            let out = wiki_targets(text);
            let mut seen: Vec<String> = Vec::new();
            let targets: Vec<String> = out
                .into_iter()
                .map(|(t, _)| t)
                .filter(|t| {
                    let k = fold(t);
                    let new = !seen.contains(&k);
                    seen.push(k);
                    new
                })
                .take(MAX_HITS)
                .collect();
            header(ui, pick("Outgoing links", "Enlaces salientes"), targets.len());
            if targets.is_empty() {
                none(ui);
            }
            for t in targets {
                let found = notes.resolve(&t, Some(doc));
                let r = crate::sidebar::row(ui, &t, 6.0, false, found.is_none());
                let r = match &found {
                    Some(p) => r.on_hover_text(p.display().to_string()),
                    None => r.on_hover_text(pick(
                        "Not created yet: click to create it",
                        "Aún no existe: haz clic para crearla",
                    )),
                };
                if r.clicked() {
                    act = Some(LinkAct::Follow(format!("[[{t}]]")));
                }
            }
            if let Some(r) = &report {
                header(ui, pick("Unlinked mentions", "Menciones sin enlazar"), r.unlinked.len());
                if r.unlinked.is_empty() {
                    none(ui);
                }
                for h in &r.unlinked {
                    if hit_row(ui, &name(&h.path), &h.line).clicked() {
                        act = Some(LinkAct::Open(h.path.clone(), h.offset));
                    }
                }
            }
        });
        act
    }
}

/// Renglón con el nombre de la nota y, debajo, la línea.
fn hit_row(ui: &mut Ui, name: &str, line: &str) -> egui::Response {
    let c = theme::colors(ui);
    let w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(egui::vec2(w, 40.0), egui::Sense::click());
    if resp.hovered() {
        ui.painter().rect_filled(rect, 4.0, c.hover);
    }
    let font = theme::body_font(ui.ctx());
    let g = iurefficient_ui::widgets::text::elided(ui, name, font.clone(), c.accent, w - 16.0);
    ui.painter().galley(egui::pos2(rect.left() + 8.0, rect.top() + 4.0), g, c.accent);
    let small = egui::FontId::new(font.size * 0.85, font.family);
    let g = iurefficient_ui::widgets::text::elided(ui, line, small, c.text_muted, w - 16.0);
    ui.painter().galley(egui::pos2(rect.left() + 8.0, rect.top() + 22.0), g, c.text_muted);
    iurefficient_ui::a11y::row(&resp, name, false);
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_backlinks_and_unlinked_mentions() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        let doc = r.join("Acta de junta.md");
        std::fs::write(&doc, "# Acta\n").unwrap();
        std::fs::write(r.join("a.md"), "Ver [[acta de junta#Pagos|el acta]].\nOtra línea\n").unwrap();
        std::fs::write(r.join("b.md"), "Ver [el acta](Acta%20de%20junta.md)\n").unwrap();
        std::fs::write(r.join("c.md"), "Uno\nSegún el Acta de Junta, sí.\n```\n[[Acta de junta]]\n```\n").unwrap();
        std::fs::write(r.join("d.md"), "Nada que ver con actas de juntas\n").unwrap();
        let files = crate::sidebar::list_docs(r);
        let rep = scan(&files, &doc);
        let mut back: Vec<_> = rep.backlinks.iter().map(|h| h.path.file_name().unwrap().to_owned()).collect();
        back.sort();
        assert_eq!(back, ["a.md", "b.md"], "el de dentro del código no cuenta");
        assert_eq!(rep.unlinked.len(), 1, "{:?}", rep.unlinked);
        assert_eq!(rep.unlinked[0].offset, 4, "la línea de la mención");
        assert_eq!(wiki_targets("[[Uno]] y [[dos/Tres#t|x]]\n```\n[[no]]\n```").len(), 2);
    }
}
