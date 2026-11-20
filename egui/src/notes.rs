//! Enlaces entre notas `[[…]]`, como IureEditor 1.x: las notas de la carpeta del documento (o la
//! abierta en el panel) para el menú de `[[`, y abrir un enlace con Ctrl+clic: la nota por su nombre
//! (sin mayúsculas ni acentos; si hay varias, la de la misma carpeta y luego la de ruta más corta) o
//! por su ruta; si no existe, se crea (con sus carpetas). Nunca fuera de la carpeta (`..`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Cada cuánto se vuelve a leer la carpeta.
const REFRESH: Duration = Duration::from_secs(5);
/// Notas como mucho en el índice.
const MAX_NOTES: usize = 10_000;

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

/// La ruta relativa con `/` y sin extensión.
fn key_of(root: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(root).ok()?.with_extension("");
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
}

/// Las notas de una carpeta (se relee cada pocos segundos).
pub(crate) struct FolderNotes {
    pub root: PathBuf,
    cache: Mutex<Option<(Instant, Vec<PathBuf>)>>,
}

impl FolderNotes {
    pub(crate) fn new(root: PathBuf) -> Self {
        FolderNotes { root, cache: Mutex::new(None) }
    }

    pub(crate) fn files(&self) -> Vec<PathBuf> {
        let Ok(mut c) = self.cache.lock() else { return Vec::new() };
        if let Some((t, f)) = c.as_ref()
            && t.elapsed() < REFRESH
        {
            return f.clone();
        }
        let mut f = crate::sidebar::list_docs(&self.root);
        f.truncate(MAX_NOTES);
        *c = Some((Instant::now(), f.clone()));
        f
    }

    /// La nota de un destino `[[destino]]` (sin `#título` ni alias), si existe.
    pub(crate) fn resolve(&self, target: &str, from: Option<&Path>) -> Option<PathBuf> {
        let t = target.trim().trim_end_matches(".md");
        let files = self.files();
        let want = fold(t);
        let mut found: Vec<&PathBuf> = if t.contains('/') {
            // Desde la raíz, desde la carpeta del documento o como final de una ruta.
            let local = from
                .and_then(Path::parent)
                .and_then(|d| key_of(&self.root, &d.join("_")))
                .and_then(|k| k.rsplit_once('/').map(|(dir, _)| fold(&format!("{dir}/{t}"))));
            files
                .iter()
                .filter(|p| {
                    key_of(&self.root, p)
                        .map(|k| fold(&k))
                        .is_some_and(|k| k == want || local.as_ref() == Some(&k) || k.ends_with(&format!("/{want}")))
                })
                .collect()
        } else {
            files.iter().filter(|p| p.file_stem().is_some_and(|s| fold(&s.to_string_lossy()) == want)).collect()
        };
        let here = from.and_then(Path::parent);
        found.sort_by_key(|p| (p.parent() != here, p.components().count(), p.to_string_lossy().into_owned()));
        found.first().map(|p| (*p).clone())
    }

    /// Dónde se crea una nota que no existe: con `/`, bajo la carpeta; si no, junto al documento.
    pub(crate) fn new_path(&self, target: &str, from: Option<&Path>) -> Option<PathBuf> {
        let t = target.trim();
        if t.is_empty() || t.split(['/', '\\']).any(|c| c == ".." || c == ".") || Path::new(t).is_absolute() {
            return None;
        }
        let base = if t.contains('/') {
            self.root.clone()
        } else {
            from.and_then(Path::parent).unwrap_or(&self.root).to_path_buf()
        };
        let mut p = base.join(t);
        if p.extension().is_none_or(|e| !matches!(e.to_str(), Some("md" | "markdown" | "txt"))) {
            let name = format!("{}.md", p.file_name()?.to_string_lossy());
            p.set_file_name(name);
        }
        p.starts_with(&self.root).then_some(p)
    }
}

impl iure_doc_ui::NoteIndex for FolderNotes {
    fn notes(&self) -> Vec<String> {
        self.files().iter().filter_map(|p| key_of(&self.root, p)).collect()
    }

    fn headings(&self, note: &str) -> Vec<String> {
        let Some(p) = self.resolve(note, None) else { return Vec::new() };
        if std::fs::metadata(&p).map_or(true, |m| m.len() > 4 * 1024 * 1024) {
            return Vec::new();
        }
        let text = std::fs::read_to_string(&p).unwrap_or_default();
        crate::sidebar::outline(&text).into_iter().map(|(_, t, _)| t).collect()
    }
}

/// Un enlace pulsado: `[[nota#título]]` → (nota, título).
pub(crate) fn split_wiki(link: &str) -> Option<(String, Option<String>)> {
    let inner = link.strip_prefix("[[")?.strip_suffix("]]")?;
    let (note, head) = match inner.split_once('#') {
        Some((n, h)) => (n.trim().to_string(), Some(h.trim().to_string()).filter(|h| !h.is_empty())),
        None => (inner.trim().to_string(), None),
    };
    Some((note, head))
}

#[cfg(test)]
mod tests {
    use super::*;
    use iure_doc_ui::NoteIndex;

    #[test]
    fn resolves_by_name_path_and_creates_inside_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::create_dir_all(r.join("Clientes")).unwrap();
        std::fs::create_dir_all(r.join("Viejo")).unwrap();
        std::fs::write(r.join("Acta de junta.md"), "# Acuerdos\n\n## Pagos\n").unwrap();
        std::fs::write(r.join("Clientes/Altamira.md"), "").unwrap();
        std::fs::write(r.join("Viejo/Altamira.md"), "").unwrap();
        let n = FolderNotes::new(r.to_path_buf());
        let mut notes = n.notes();
        notes.sort();
        assert_eq!(notes, ["Acta de junta", "Clientes/Altamira", "Viejo/Altamira"]);
        assert_eq!(n.resolve("acta DE junta", None), Some(r.join("Acta de junta.md")), "sin mayúsculas");
        assert_eq!(n.resolve("Viejo/Altamira", None), Some(r.join("Viejo/Altamira.md")));
        // Dos con el mismo nombre: la de la carpeta del documento.
        let from = r.join("Viejo/otra.md");
        assert_eq!(n.resolve("Altamira", Some(&from)), Some(r.join("Viejo/Altamira.md")));
        assert_eq!(n.headings("Acta de junta"), ["Acuerdos", "Pagos"]);
        assert_eq!(n.new_path("Nueva", Some(&from)), Some(r.join("Viejo/Nueva.md")));
        assert_eq!(n.new_path("Temas/Nueva", Some(&from)), Some(r.join("Temas/Nueva.md")));
        assert_eq!(n.new_path("../fuera", Some(&from)), None);
        assert_eq!(n.new_path("/etc/passwd", None), None);
        assert_eq!(split_wiki("[[Acta#Pagos]]"), Some(("Acta".into(), Some("Pagos".into()))));
        assert_eq!(split_wiki("https://x.mx"), None);
    }
}
