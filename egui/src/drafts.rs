//! Borradores para recuperar lo no guardado tras un cierre inesperado (como IureEditor Tauri).
//!
//! Mientras un documento tiene cambios sin guardar, 2,5 s después del último cambio se escribe
//! su borrador (en otro hilo; nunca interrumpe la edición). Al guardar, o al cerrar con «No
//! guardar», se borra. Si la app termina mal, el borrador queda y al abrirla se ofrece
//! recuperarlo.
//!
//! Un archivo por ventana (`<pid>.json` en la carpeta de borradores) con la ruta del documento,
//! el texto y la hora: dos ventanas abiertas no se pisan, y el borrador de una ventana que sigue
//! viva no se ofrece (en Linux se mira `/proc/<pid>`).

use std::path::{Path, PathBuf};

/// Borrador más grande que se escribe o se lee.
const MAX_BYTES: u64 = 32 * 1024 * 1024;
/// Borradores que se leen como mucho.
const MAX_DRAFTS: usize = 50;

/// Un borrador.
#[derive(Clone, Debug, PartialEq)]
pub struct Draft {
    /// El documento (`None`: sin título).
    pub path: Option<PathBuf>,
    pub text: String,
    /// Segundos desde 1970.
    pub saved_at: u64,
    /// La ventana que lo escribió.
    pub pid: u32,
}

/// Carpeta de datos de la app: `IUREDITOR_DATA_DIR`, o `~/.local/share/iureditor2` (o
/// `%APPDATA%\iureditor2`).
pub fn data_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("IUREDITOR_DATA_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(d));
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
    Some(base.join("iureditor2"))
}

/// Carpeta de borradores.
pub fn drafts_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("borradores"))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// ¿La ventana `pid` sigue abierta? Solo se sabe en Linux; en los demás, no.
fn alive(pid: u32) -> bool {
    pid != std::process::id() && cfg!(target_os = "linux") && Path::new(&format!("/proc/{pid}")).exists()
}

/// Escribe el borrador de esta ventana (atómico: temporal y renombrar).
pub fn write(dir: &Path, path: Option<&Path>, text: &str) -> std::io::Result<()> {
    if text.len() as u64 > MAX_BYTES {
        return Ok(());
    }
    std::fs::create_dir_all(dir)?;
    let pid = std::process::id();
    let v = serde_json::json!({
        "path": path.map(|p| p.to_string_lossy().into_owned()),
        "text": text,
        "saved_at": now_secs(),
        "pid": pid,
    });
    let file = dir.join(format!("{pid}.json"));
    let tmp = dir.join(format!(".{pid}.json.tmp"));
    std::fs::write(&tmp, v.to_string())?;
    std::fs::rename(&tmp, &file)
}

/// Borra el borrador de esta ventana.
pub fn clear(dir: &Path) {
    let _ = std::fs::remove_file(dir.join(format!("{}.json", std::process::id())));
}

fn read_one(p: &Path) -> Option<Draft> {
    if std::fs::metadata(p).ok()?.len() > MAX_BYTES {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    let text = v.get("text")?.as_str()?.to_string();
    if text.trim().is_empty() {
        return None;
    }
    Some(Draft {
        path: v.get("path").and_then(|x| x.as_str()).map(PathBuf::from),
        text,
        saved_at: v.get("saved_at").and_then(serde_json::Value::as_u64).unwrap_or(0),
        pid: v.get("pid").and_then(serde_json::Value::as_u64).and_then(|p| u32::try_from(p).ok()).unwrap_or(0),
    })
}

/// Borradores de ventanas que ya no están (el más reciente primero).
pub fn orphans(dir: &Path) -> Vec<(PathBuf, Draft)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut v: Vec<(PathBuf, Draft)> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .take(MAX_DRAFTS * 4)
        .filter_map(|p| read_one(&p).map(|d| (p, d)))
        .filter(|(_, d)| !alive(d.pid))
        .take(MAX_DRAFTS)
        .collect();
    v.sort_by_key(|(_, d)| std::cmp::Reverse(d.saved_at));
    v
}

/// Borra unos borradores (ya recuperados o descartados).
pub fn remove(files: &[PathBuf]) {
    for f in files {
        let _ = std::fs::remove_file(f);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("borradores");
        write(&d, Some(Path::new("/docs/nota.md")), "texto sin guardar").unwrap();
        // El de esta ventana (viva) no es huérfano…
        let mine = read_one(&d.join(format!("{}.json", std::process::id()))).unwrap();
        assert_eq!(mine.text, "texto sin guardar");
        assert_eq!(mine.path.as_deref(), Some(Path::new("/docs/nota.md")));
        // …pero sí lo es para otra ventana después de un cierre inesperado: se simula con otro pid.
        std::fs::write(
            d.join("4000000.json"),
            serde_json::json!({"path": null, "text": "huérfano", "saved_at": 5, "pid": 4_000_000u32}).to_string(),
        )
        .unwrap();
        std::fs::write(d.join("vacío.json"), r#"{"text":"  ","pid":1}"#).unwrap();
        std::fs::write(d.join("roto.json"), "no es json").unwrap();
        let o = orphans(&d);
        assert!(o.iter().any(|(_, x)| x.text == "huérfano" && x.path.is_none()));
        assert!(o.iter().all(|(_, x)| !x.text.trim().is_empty()), "vacíos y rotos fuera");
        clear(&d);
        assert!(!d.join(format!("{}.json", std::process::id())).exists());
        remove(&o.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>());
        assert!(!d.join("4000000.json").exists());
    }
}
