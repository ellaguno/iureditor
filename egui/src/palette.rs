//! Paleta de comandos (Ctrl+Mayús+P) e «Ir a nota» (Ctrl+K), como la 1.x: un cuadro con un campo
//! de búsqueda y la lista filtrada; Intro elige, Esc cierra, ↑/↓ se mueven.

use egui::{Key, RichText, Ui};
use iurefficient_ui::{pick, theme};

use crate::chrome::MenuAct;

/// Renglones que se muestran como mucho.
const MAX_SHOWN: usize = 200;

/// Una paleta abierta.
pub(crate) struct Palette {
    pub title: &'static str,
    pub query: String,
    pub items: Vec<(String, MenuAct)>,
    pub sel: usize,
    focus: bool,
}

impl Palette {
    /// Los comandos de la app.
    pub(crate) fn commands() -> Self {
        use crate::chrome::MenuAct as M;
        use crate::export::Format;
        use crate::sidebar::SideTab;
        let items = [
            (pick("New document", "Nuevo documento"), M::New),
            (pick("Open…", "Abrir…"), M::Open),
            (pick("Open folder…", "Abrir carpeta…"), M::OpenFolder),
            (pick("Go to note…", "Ir a nota…"), M::QuickSwitcher),
            (pick("Save", "Guardar"), M::Save),
            (pick("Save as…", "Guardar como…"), M::SaveAs),
            (pick("Export to PDF…", "Exportar a PDF…"), M::Export(Format::Pdf)),
            (pick("Export to DOCX…", "Exportar a DOCX…"), M::Export(Format::Docx)),
            (pick("Export to HTML…", "Exportar a HTML…"), M::Export(Format::Html)),
            (pick("Find…", "Buscar…"), M::Find),
            (pick("Replace…", "Reemplazar…"), M::Replace),
            (pick("Go to line…", "Ir a línea…"), M::GotoLine),
            (pick("Insert table of contents", "Insertar índice"), M::InsertToc),
            (pick("Select all", "Seleccionar todo"), M::SelectAll),
            (pick("Folder files", "Archivos de la carpeta"), M::Side(SideTab::Files)),
            (pick("Search in files", "Buscar en archivos"), M::FindInFiles),
            (pick("Document outline", "Esquema del documento"), M::Side(SideTab::Outline)),
            (pick("Note links", "Enlaces de la nota"), M::Side(SideTab::Links)),
            ("Iurefficient", M::Side(SideTab::Iurefficient)),
            (pick("Assistant", "Asistente"), M::Side(SideTab::Assistant)),
            (pick("Source code", "Código fuente"), M::SourceCode),
            (pick("Line numbers", "Números de línea"), M::LineNumbers),
            (pick("Zoom in", "Aumentar zoom"), M::ZoomIn),
            (pick("Zoom out", "Reducir zoom"), M::ZoomOut),
            (pick("Reset zoom", "Zoom normal"), M::ZoomReset),
            (pick("Page width: medium", "Ancho de página: medio"), M::PageWidth(crate::drafts::PageWidth::Medium)),
            (pick("Page width: wide", "Ancho de página: ancho"), M::PageWidth(crate::drafts::PageWidth::Wide)),
            (pick("Page width: full", "Ancho de página: completo"), M::PageWidth(crate::drafts::PageWidth::Full)),
            (pick("Theme: light", "Tema: claro"), M::Theme(iurefficient_ui::theme::ThemeMode::Light)),
            (pick("Theme: dark", "Tema: oscuro"), M::Theme(iurefficient_ui::theme::ThemeMode::Dark)),
            (pick("Theme: system", "Tema: del sistema"), M::Theme(iurefficient_ui::theme::ThemeMode::System)),
            (pick("IureEditor help", "Ayuda de IureEditor"), M::Help),
            (pick("Check for updates…", "Buscar actualizaciones…"), M::CheckUpdates),
            (pick("About IureEditor", "Acerca de IureEditor"), M::About),
            (pick("Close tab", "Cerrar pestaña"), M::CloseTab),
            (pick("Quit", "Salir"), M::Quit),
        ]
        .into_iter()
        .map(|(l, a)| (l.to_string(), a))
        .collect();
        Palette {
            title: pick("Command palette", "Paleta de comandos"),
            query: String::new(),
            items,
            sel: 0,
            focus: true,
        }
    }

    /// Las notas de la carpeta (nombre relativo y ruta).
    pub(crate) fn notes(root: &std::path::Path, files: &[std::path::PathBuf]) -> Self {
        let items = files
            .iter()
            .map(|p| {
                let rel = p.strip_prefix(root).unwrap_or(p).display().to_string();
                (rel, MenuAct::OpenRecent(p.clone()))
            })
            .collect();
        Palette { title: pick("Go to note", "Ir a nota"), query: String::new(), items, sel: 0, focus: true }
    }

    /// Lo que coincide con lo escrito (todas las palabras, sin distinguir mayúsculas ni acentos).
    pub(crate) fn matches(&self) -> Vec<&(String, MenuAct)> {
        let words: Vec<String> = fold(&self.query).split_whitespace().map(str::to_string).collect();
        self.items.iter().filter(|(l, _)| words.iter().all(|w| fold(l).contains(w.as_str()))).take(MAX_SHOWN).collect()
    }
}

/// Minúsculas y sin acentos, para comparar.
fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            c => c,
        })
        .collect()
}

/// Dibuja la paleta. `Some(Some(act))`: se eligió; `Some(None)`: se cerró; `None`: sigue abierta.
pub(crate) fn show(ctx: &egui::Context, p: &mut Palette) -> Option<Option<MenuAct>> {
    let mut out = None;
    egui::Window::new(p.title)
        .id(egui::Id::unique("iureditor-palette"))
        .title_bar(false)
        .collapsible(false)
        .resizable(false)
        .fixed_size([520.0, 360.0])
        .anchor(egui::Align2::CENTER_TOP, [0.0, 80.0])
        .show(ctx, |ui| {
            out = body(ui, p);
        });
    out
}

fn body(ui: &mut Ui, p: &mut Palette) -> Option<Option<MenuAct>> {
    let c = theme::colors(ui);
    ui.label(RichText::new(p.title).strong());
    let r = ui.add(
        egui::TextEdit::singleline(&mut p.query)
            .desired_width(f32::INFINITY)
            .hint_text(pick("Type to filter…", "Escribe para filtrar…")),
    );
    if std::mem::take(&mut p.focus) {
        r.request_focus();
    }
    if r.changed() {
        p.sel = 0;
    }
    let (up, down, enter, esc) = ui.input_mut(|i| {
        (
            i.consume_key(egui::Modifiers::NONE, Key::ArrowUp),
            i.consume_key(egui::Modifiers::NONE, Key::ArrowDown),
            i.consume_key(egui::Modifiers::NONE, Key::Enter),
            i.consume_key(egui::Modifiers::NONE, Key::Escape),
        )
    });
    if esc {
        return Some(None);
    }
    let shown: Vec<(String, MenuAct)> = p.matches().into_iter().cloned().collect();
    let n = shown.len();
    if down && n > 0 {
        p.sel = (p.sel + 1).min(n - 1);
    }
    if up {
        p.sel = p.sel.saturating_sub(1);
    }
    if enter {
        return Some(shown.get(p.sel).map(|(_, a)| a.clone()));
    }
    let mut picked = None;
    egui::ScrollArea::vertical().max_height(300.0).show(ui, |ui| {
        if shown.is_empty() {
            ui.label(RichText::new(pick("Nothing matches.", "Nada coincide.")).color(c.text_muted));
        }
        for (i, (label, a)) in shown.iter().enumerate() {
            let r = ui.add(
                egui::Button::selectable(i == p.sel, label.as_str()).min_size(egui::vec2(ui.available_width(), 24.0)),
            );
            if i == p.sel && (up || down) {
                r.scroll_to_me(None);
            }
            if r.clicked() {
                picked = Some(a.clone());
            }
        }
    });
    picked.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_all_words_without_accents() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let mut p = Palette::commands();
        p.query = "pagina ancho".into();
        let m: Vec<_> = p.matches().into_iter().map(|(l, _)| l.clone()).collect();
        assert!(m.iter().all(|l| l.starts_with("Ancho de página")), "{m:?}");
        assert_eq!(m.len(), 3);
        p.query = "indice".into();
        assert_eq!(p.matches().first().map(|(_, a)| a.clone()), Some(MenuAct::InsertToc));
    }
}
