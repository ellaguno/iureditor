//! Diagramas dibujados en su lugar dentro del editor: el mismo motor que IureDesk
//! (`iuredesk-html-view`: `mermaid-svg` y el dibujo de mapas mentales de la suite, pintados con
//! Blitz), con los colores del tema de IureEditor. Así una nota se ve igual en las dos apps.

use std::hash::{Hash, Hasher};

use iuredesk_html_view::diagram;
use iuredesk_html_view::markdown::NoteStyle;
use iuredesk_html_view::mindmap::Layout;
use iurefficient_ui::lang::pick;

/// Dibuja bloques ```` ```mermaid ```` y mapas mentales (`> [!MINDMAP…]`).
pub struct Diagrams {
    style: NoteStyle,
    background: [u8; 3],
}

fn rgb(c: egui::Color32) -> [u8; 3] {
    [c.r(), c.g(), c.b()]
}

impl Diagrams {
    /// Con los colores y la letra del tema actual.
    pub fn new(ui: &egui::Ui) -> Self {
        let c = iurefficient_ui::theme::colors(ui);
        let style = NoteStyle {
            text: rgb(c.text),
            muted: rgb(c.text_muted),
            accent: rgb(c.accent),
            code_bg: rgb(c.surface_alt),
            border: rgb(c.separator),
            font_px: iurefficient_ui::theme::body_font(ui.ctx()).size + 1.0,
        };
        Diagrams { style, background: rgb(ui.visuals().panel_fill) }
    }
}

impl iure_doc_ui::DiagramRenderer for Diagrams {
    fn accepts(&self, block: &str) -> bool {
        diagram::is_diagram_block(block)
    }

    fn key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        format!("{:?}{:?}", self.style, self.background).hash(&mut h);
        h.finish()
    }

    fn render(&self, block: &str, scale: f32) -> Result<iure_doc_ui::DiagramImage, String> {
        // Los mapas sin distribución propia, como siempre en IureEditor: árbol hacia la derecha.
        let px = diagram::draw_block(block, &self.style, Layout::Right, scale, self.background)
            .map_err(|e| pick(&e.en, &e.es).to_string())?;
        Ok(iure_doc_ui::DiagramImage {
            width: px.width as usize,
            height: px.height as usize,
            rgba: px.rgba,
            points: [px.points.0, px.points.1],
        })
    }
}
