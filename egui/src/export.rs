//! Exportar el documento (S1.14): página web autocontenida (HTML) y Word (DOCX) con
//! `iure-doc-export`. Las imágenes salen de la carpeta del documento (la misma política que el
//! editor) y los diagramas se dibujan con el mismo motor que en pantalla, en colores de papel.

use std::path::{Path, PathBuf};

use iure_doc_export::{Diagram, FolderResources, Options, Picture, Resources};
use iuredesk_html_view::diagram;
use iuredesk_html_view::markdown::NoteStyle;
use iuredesk_html_view::mindmap::Layout;
use iurefficient_ui::lang::pick;

/// Formato de la exportación.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Html,
    Docx,
}

impl Format {
    pub fn ext(self) -> &'static str {
        match self {
            Format::Html => "html",
            Format::Docx => "docx",
        }
    }

    /// Nombre del filtro del diálogo.
    pub fn filter(self) -> &'static str {
        match self {
            Format::Html => pick("Web page", "Página web"),
            Format::Docx => "Word",
        }
    }
}

/// Píxeles por punto de los diagramas exportados (nítidos al imprimir o ampliar).
const DIAGRAM_SCALE: f32 = 2.0;

/// Imágenes de la carpeta del documento y diagramas dibujados sobre blanco.
struct ExportResources {
    folder: FolderResources,
    style: NoteStyle,
}

impl Resources for ExportResources {
    fn image(&self, src: &str) -> Option<Picture> {
        self.folder.image(src)
    }

    fn diagram(&self, block: &str) -> Option<Diagram> {
        if !diagram::is_diagram_block(block) {
            return None;
        }
        // Los mapas sin distribución propia, como siempre en IureEditor: árbol hacia la derecha.
        let px = diagram::draw_block(block, &self.style, Layout::Right, DIAGRAM_SCALE, [255, 255, 255]).ok()?;
        let img = image::RgbaImage::from_raw(px.width, px.height, px.rgba)?;
        let mut png = std::io::Cursor::new(Vec::new());
        img.write_to(&mut png, image::ImageFormat::Png).ok()?;
        // Píxeles CSS → puntos.
        let points = (px.points.0 * 0.75, px.points.1 * 0.75);
        Some(Diagram { svg: None, png: iure_doc_export::picture_from_bytes(png.into_inner()), points })
    }
}

/// Exporta `text` (el documento de la carpeta `base`) a `out`. Bloqueante (dibuja diagramas):
/// se llama en otro hilo. El error, en el idioma de la interfaz.
pub fn export(text: &str, base: Option<PathBuf>, format: Format, out: &Path) -> Result<(), String> {
    let doc = iure_doc::Document::parse(text);
    let res = ExportResources { folder: FolderResources::new(base), style: NoteStyle::default() };
    let lang = if pick("en", "es") == "en" { "en" } else { "es" };
    // Papel carta (el de México y EE. UU.), como la versión Tauri.
    let opts = Options { lang: lang.to_string(), ..Options::default() };
    let bytes = match format {
        Format::Html => iure_doc_export::html::html(&doc, &res, &opts).into_bytes(),
        Format::Docx => iure_doc_export::docx::docx(&doc, &res, &opts).map_err(|e| pick(&e.en, &e.es).to_string())?,
    };
    write_atomic(out, &bytes).map_err(|e| {
        format!(
            "{} «{}» ({e}).",
            pick("The file could not be written:", "No se pudo escribir el archivo:"),
            out.display()
        )
    })
}

/// Escribe en un temporal junto al destino y lo renombra: nunca queda un archivo a medias.
fn write_atomic(out: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let name = out.file_name().map_or_else(|| "exportado".into(), |n| n.to_string_lossy().into_owned());
    let tmp = out.with_file_name(format!(".{name}.{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, out).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_html_and_word_with_images_and_diagrams() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        image::RgbaImage::from_pixel(3, 2, image::Rgba([9, 9, 9, 255])).save(dir.path().join("assets/a.png")).unwrap();
        let md = "# Informe\n\n![a](assets/a.png)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\n\
                  > [!MINDMAP|map] Caso\n> - Uno\n> - Dos\n";
        let html = dir.path().join("informe.html");
        export(md, Some(dir.path().to_path_buf()), Format::Html, &html).unwrap();
        let h = std::fs::read_to_string(&html).unwrap();
        assert!(h.contains("<title>Informe</title>"));
        assert_eq!(h.matches("data:image/png;base64,").count(), 3, "imagen, diagrama y mapa");
        let docx = dir.path().join("informe.docx");
        export(md, Some(dir.path().to_path_buf()), Format::Docx, &docx).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&docx).unwrap()).unwrap();
        assert!(z.by_name("word/media/image3.png").is_ok(), "tres imágenes en el Word");
        // Nada de temporales.
        let left: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(left.is_empty());
        // Sin permiso de escritura: error en lenguaje humano, sin pánico.
        let bad = dir.path().join("no/existe/x.docx");
        assert!(export(md, None, Format::Docx, &bad).unwrap_err().contains("x.docx"));
    }
}
