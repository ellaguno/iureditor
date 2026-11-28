//! Enlaces `iureditor://` (los mismos de la versión Tauri) y argumentos de la línea de órdenes.
//!
//! - `iureditor://open?path=/ruta/doc.md` (o `file:///…`, o una ruta): abrir el documento.
//! - `iureditor://insert?text=<texto>&path=<ruta opcional>`: escribir en el cursor (IureVoz al
//!   dictar; entra aunque la ventana no tenga el foco, que GNOME en Wayland no le da a otra app).
//! - `iureditor://edit?action=<delete-word|delete-line|undo>&path=<ruta opcional>`: edición
//!   mínima por voz.
//! - `iureditor://iurefficient/doc?case=<id>&title=<proyecto>&doc=<id>&name=<archivo>`: abrir un
//!   documento de la instancia (IureDesk, IureProject) como espejo local, como la 1.x.
//!
//! Un enlace solo abre o escribe en un documento ya abierto por el usuario (o el que pide abrir):
//! nunca guarda, borra archivos ni ejecuta nada.

use std::path::PathBuf;

/// Texto más largo que se acepta en `insert`.
const MAX_INSERT: usize = 64 * 1024;

/// Lo que pide un argumento.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
    Open(PathBuf),
    Insert { text: String, path: Option<PathBuf> },
    Edit { action: iure_doc_ui::ExternalEdit, path: Option<PathBuf> },
    IureDoc { case_id: Option<String>, case_title: Option<String>, doc_id: String, file_name: String },
}

/// Un argumento de la línea de órdenes (ruta o enlace). `None` si no se entiende.
pub fn parse(arg: &str) -> Option<Link> {
    let lower = arg.trim_start().to_ascii_lowercase();
    if lower.starts_with("file:") {
        return url::Url::parse(arg.trim()).ok()?.to_file_path().ok().map(Link::Open);
    }
    if !lower.starts_with("iureditor:") {
        return (!arg.trim().is_empty() && !arg.starts_with('-')).then(|| Link::Open(PathBuf::from(arg)));
    }
    let u = url::Url::parse(arg.trim()).ok()?;
    let route = format!("{}{}", u.host_str().unwrap_or(""), u.path());
    let get = |k: &str| u.query_pairs().find(|(q, _)| q == k).map(|(_, v)| v.into_owned()).filter(|v| !v.is_empty());
    let path = get("path").map(PathBuf::from).filter(|p| p.is_absolute());
    match route.trim_matches('/') {
        "open" => path.map(Link::Open),
        "insert" => {
            let text = get("text")?;
            (text.len() <= MAX_INSERT).then_some(Link::Insert { text, path })
        }
        "edit" => {
            let action = match get("action")?.as_str() {
                "delete-word" => iure_doc_ui::ExternalEdit::DeleteWord,
                "delete-line" => iure_doc_ui::ExternalEdit::DeleteLine,
                "undo" => iure_doc_ui::ExternalEdit::Undo,
                _ => return None,
            };
            Some(Link::Edit { action, path })
        }
        "iurefficient/doc" => Some(Link::IureDoc {
            case_id: get("case"),
            case_title: get("title"),
            doc_id: get("doc")?,
            file_name: get("name").unwrap_or_else(|| iurefficient_ui::pick("document.md", "documento.md").into()),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use iure_doc_ui::ExternalEdit;

    #[test]
    fn instance_documents() {
        assert_eq!(
            parse("iureditor://iurefficient/doc?case=c1&title=Caso%20A&doc=d9&name=nota.md"),
            Some(Link::IureDoc {
                case_id: Some("c1".into()),
                case_title: Some("Caso A".into()),
                doc_id: "d9".into(),
                file_name: "nota.md".into()
            })
        );
        assert_eq!(parse("iureditor://iurefficient/doc?case=c1"), None, "sin documento");
    }

    #[test]
    fn links_like_the_tauri_version() {
        assert_eq!(parse("iureditor://open?path=%2Ftmp%2Fa%20b.md"), Some(Link::Open("/tmp/a b.md".into())));
        assert_eq!(parse("file:///tmp/c.md"), Some(Link::Open("/tmp/c.md".into())));
        assert_eq!(parse("/tmp/d.md"), Some(Link::Open("/tmp/d.md".into())));
        assert_eq!(
            parse("iureditor://insert?text=Hola%2C%20mundo.%0A&path=%2Ftmp%2Fa.md"),
            Some(Link::Insert { text: "Hola, mundo.\n".into(), path: Some("/tmp/a.md".into()) })
        );
        assert_eq!(parse("iureditor://insert?text=x"), Some(Link::Insert { text: "x".into(), path: None }));
        assert_eq!(
            parse("IUREDITOR://edit?action=delete-word"),
            Some(Link::Edit { action: ExternalEdit::DeleteWord, path: None })
        );
        for bad in [
            "iureditor://insert?text=",
            "iureditor://edit?action=rm-rf",
            "iureditor://open?path=relativa.md",
            "iureditor://borrar?path=%2Ftmp%2Fa.md",
            "--mcp",
            "",
        ] {
            assert_eq!(parse(bad), None, "{bad}");
        }
        let long = format!("iureditor://insert?text={}", "a".repeat(MAX_INSERT + 1));
        assert_eq!(parse(&long), None);
    }
}
