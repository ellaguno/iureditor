//! El documento abierto: leer, guardar y saber si cambió (sin egui).

use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Documento más grande que se abre.
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;

/// Errores al leer o guardar, en lenguaje humano.
#[derive(Debug, thiserror::Error)]
pub enum DocError {
    #[error("{0}")]
    Io(String),
    #[error("too big")]
    TooBig,
    #[error("not text")]
    NotText,
}

impl DocError {
    /// Mensaje para la persona.
    pub fn human(&self, path: &Path) -> String {
        let name = path.file_name().map_or_else(|| path.display().to_string(), |n| n.to_string_lossy().into_owned());
        let pick = iurefficient_ui::lang::pick;
        match self {
            DocError::Io(e) => {
                format!("{} «{name}»: {e}", pick("Could not open or save", "No se pudo abrir o guardar"))
            }
            DocError::TooBig => {
                format!("«{name}» {}", pick("is too big (more than 16 MB)", "es muy grande (más de 16 MB)"))
            }
            DocError::NotText => format!("«{name}» {}", pick("is not a text file", "no es un archivo de texto")),
        }
    }
}

/// Un documento: su archivo (si tiene), el texto y lo último guardado.
#[derive(Clone, Debug, Default)]
pub struct Doc {
    pub path: Option<PathBuf>,
    pub text: String,
    /// El texto tal como está en el disco.
    pub saved: String,
    /// Modificación del archivo al leerlo o guardarlo (para ver cambios de otros).
    pub mtime: Option<SystemTime>,
}

fn mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

impl Doc {
    /// Lee un archivo.
    pub fn open(path: &Path) -> Result<Doc, DocError> {
        let meta = std::fs::metadata(path).map_err(|e| DocError::Io(e.to_string()))?;
        if meta.len() > MAX_BYTES {
            return Err(DocError::TooBig);
        }
        let bytes = std::fs::read(path).map_err(|e| DocError::Io(e.to_string()))?;
        let text = String::from_utf8(bytes).map_err(|_| DocError::NotText)?;
        Ok(Doc { path: Some(path.to_path_buf()), saved: text.clone(), text, mtime: mtime(path) })
    }

    /// ¿Hay cambios sin guardar?
    pub fn dirty(&self) -> bool {
        self.text != self.saved
    }

    /// Guarda en su archivo (o en `path`, que pasa a ser el suyo). Escribe a un temporal junto al
    /// archivo y lo renombra: un corte a medias no deja el documento roto.
    pub fn save(&mut self, path: Option<&Path>) -> Result<(), DocError> {
        let target =
            path.map(Path::to_path_buf).or_else(|| self.path.clone()).ok_or(DocError::Io("sin archivo".into()))?;
        let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let name = target.file_name().map_or_else(|| "documento".into(), |n| n.to_string_lossy().into_owned());
        let tmp = dir.join(format!(".{name}.iureditor-tmp"));
        std::fs::write(&tmp, self.text.as_bytes()).map_err(|e| DocError::Io(e.to_string()))?;
        if let Err(e) = std::fs::rename(&tmp, &target) {
            let _ = std::fs::remove_file(&tmp);
            return Err(DocError::Io(e.to_string()));
        }
        self.saved = self.text.clone();
        self.mtime = mtime(&target);
        self.path = Some(target);
        Ok(())
    }

    /// ¿Otro programa cambió el archivo desde que se leyó o guardó?
    pub fn changed_on_disk(&self) -> bool {
        match &self.path {
            Some(p) => mtime(p) != self.mtime,
            None => false,
        }
    }

    /// Nombre para la barra de título.
    pub fn title(&self) -> String {
        let name = self.path.as_ref().and_then(|p| p.file_name()).map_or_else(
            || iurefficient_ui::lang::pick("Untitled", "Sin título").to_string(),
            |n| n.to_string_lossy().into_owned(),
        );
        format!("{}{name} — IureEditor", if self.dirty() { "• " } else { "" })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_edit_save_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "# Título\n\nTexto\n").unwrap();
        let mut d = Doc::open(&p).unwrap();
        assert!(!d.dirty());
        assert!(d.title().starts_with("nota.md"));
        d.text.push_str("\nMás\n");
        assert!(d.dirty() && d.title().starts_with("• "));
        d.save(None).unwrap();
        assert!(!d.dirty());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Título\n\nTexto\n\nMás\n");
        assert!(!d.changed_on_disk());
        // Sin temporales sueltos.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn new_documents_need_a_file_and_hostile_files_are_refused() {
        let mut d = Doc { text: "hola".into(), ..Default::default() };
        assert!(d.save(None).is_err());
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.md");
        d.save(Some(&p)).unwrap();
        assert_eq!(d.path.as_deref(), Some(p.as_path()));
        let bin = dir.path().join("bin.md");
        std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert!(matches!(Doc::open(&bin), Err(DocError::NotText)));
        assert!(matches!(Doc::open(&dir.path().join("no")), Err(DocError::Io(_))));
    }
}
