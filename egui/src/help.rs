//! Ayuda › Ayuda de IureEditor (F1): la guía de la 1.x, en español o inglés, abierta como un
//! documento. Se copia a la carpeta de datos (con su imagen) para que el editor la dibuje como
//! cualquier otro archivo.

use std::path::{Path, PathBuf};

use iurefficient_ui::pick;

const AYUDA: &str = include_str!("../assets/ayuda/ayuda.md");
const HELP: &str = include_str!("../assets/ayuda/help.md");
const LOGO: &[u8] = include_bytes!("../assets/ayuda/img/iureditor.png");

/// Escribe la guía en `dir` (si cambió) y devuelve su ruta.
pub(crate) fn write_to(dir: &Path) -> std::io::Result<PathBuf> {
    let (name, text) =
        if pick("en", "es") == "es" { ("Ayuda de IureEditor.md", AYUDA) } else { ("IureEditor help.md", HELP) };
    std::fs::create_dir_all(dir.join("img"))?;
    let logo = dir.join("img").join("iureditor.png");
    if std::fs::read(&logo).ok().as_deref() != Some(LOGO) {
        std::fs::write(&logo, LOGO)?;
    }
    let path = dir.join(name);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(text) {
        std::fs::write(&path, text)?;
    }
    Ok(path)
}

/// Los enlaces de Ayuda (como la 1.x): nombre en inglés, en español y dirección.
pub(crate) const LINKS: [(&str, &str, &str); 4] = [
    ("Apps", "Apps", "https://iurefficient.com"),
    ("Blog", "Blog", "https://blog.iurefficient.com"),
    ("Iurefficient videos", "Videos de Iurefficient", "https://youtube.com/@iurefficient"),
    ("Demo", "Demo", "https://demo.iurefficient.com"),
];

#[cfg(test)]
mod tests {
    #[test]
    fn the_guide_is_written_with_its_image() {
        let dir = tempfile::tempdir().unwrap();
        let p = super::write_to(dir.path()).unwrap();
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("img/iureditor.png") && text.len() > 10_000);
        assert!(dir.path().join("img/iureditor.png").is_file());
        // La segunda vez no falla (ya está).
        assert_eq!(super::write_to(dir.path()).unwrap(), p);
    }
}
