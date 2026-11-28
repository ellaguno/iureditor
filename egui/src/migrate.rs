//! Al primer arranque de la 2.0 (una sola vez): trae de la 1.x (Tauri, carpeta
//! `com.ellaguno.iureditor`) los recientes, la sesión (pestañas abiertas) y los
//! borradores sin guardar. No borra ni cambia nada de la 1.x. Las plantillas ya se leen de su
//! carpeta; el tema y el zoom vivían en el almacenamiento del navegador de la 1.x y no se traen.

use std::path::{Path, PathBuf};

/// Marca de que la migración ya se hizo (en la carpeta de datos de la 2.0).
const MARK: &str = "migrado-1x";
/// Archivo más grande que se lee de la 1.x.
const MAX_BYTES: u64 = 32 * 1024 * 1024;

/// Carpeta de datos de la 1.x.
fn old_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join("com.ellaguno.iureditor"))
}

/// Lo que se trajo de la 1.x.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Migrated {
    pub recent: usize,
    pub tabs: usize,
    pub drafts: usize,
}

/// Migra si no se hizo antes. `None`: ya estaba hecho (o no hay carpeta de datos); `Some`: es el
/// primer arranque de la 2.0 (con lo que se trajo, quizá nada si no había 1.x).
pub(crate) fn run() -> Option<Migrated> {
    let new = crate::drafts::data_dir()?;
    let old = old_dir();
    run_in(old.as_deref(), &new)
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    if std::fs::metadata(p).ok()?.len() > MAX_BYTES {
        return None;
    }
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn strings(v: Option<&serde_json::Value>) -> Vec<PathBuf> {
    v.and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).map(PathBuf::from).collect())
        .unwrap_or_default()
}

pub(crate) fn run_in(old: Option<&Path>, new: &Path) -> Option<Migrated> {
    let mark = new.join(MARK);
    if mark.exists() {
        return None;
    }
    let _ = std::fs::create_dir_all(new);
    let mut m = Migrated::default();
    if let Some(old) = old.filter(|d| d.is_dir()) {
        let prefs = new.join("preferencias.json");
        // Recientes: los de la 2.0 primero (si ya había alfas), luego los de la 1.x.
        if let Some(v) = read_json(&old.join("recent.json")) {
            let mut list = crate::drafts::load_recent(&prefs);
            let before = list.len();
            for p in strings(v.get("recentFiles")).into_iter().filter(|p| p.is_file()) {
                if list.len() >= crate::drafts::MAX_RECENT {
                    break;
                }
                if !list.contains(&p) {
                    list.push(p);
                }
            }
            m.recent = list.len() - before;
            if m.recent > 0 {
                let v: Vec<String> = list.iter().map(|p| p.display().to_string()).collect();
                crate::drafts::save_pref(&prefs, "recent", serde_json::json!(v));
            }
        }
        // Sesión: solo si la 2.0 no tiene una propia.
        let session = new.join("sesion.json");
        if !session.exists()
            && let Some(v) = read_json(&old.join("session.json"))
            && let Some(tabs) = v.get("openTabs")
        {
            let paths: Vec<PathBuf> = strings(tabs.get("paths")).into_iter().filter(|p| p.is_file()).take(50).collect();
            let active = tabs
                .get("activePath")
                .and_then(|a| a.as_str())
                .and_then(|a| paths.iter().position(|p| p == Path::new(a)))
                .unwrap_or(paths.len().saturating_sub(1));
            if !paths.is_empty() {
                crate::drafts::save_session(&session, &paths, active);
                m.tabs = paths.len();
            }
        }
        // Borradores: los que difieren del archivo en disco (o sin título) se ofrecen al abrir.
        if let Some(v) = read_json(&old.join("draft.json"))
            && let Some(list) = v.get("drafts").and_then(|d| d.as_array())
        {
            let dir = new.join("borradores");
            for (i, d) in list.iter().enumerate().take(50) {
                let Some(text) = d.get("markdown").and_then(|t| t.as_str()).filter(|t| !t.trim().is_empty()) else {
                    continue;
                };
                let path = d.get("path").and_then(|p| p.as_str()).map(PathBuf::from);
                if let Some(p) = &path
                    && std::fs::read_to_string(p).is_ok_and(|disk| same_text(&disk, text))
                {
                    continue;
                }
                let _ = std::fs::create_dir_all(&dir);
                let v = serde_json::json!({
                    "path": path.map(|p| p.to_string_lossy().into_owned()),
                    "text": text,
                    "saved_at": d.get("savedAt").and_then(serde_json::Value::as_u64).map_or(0, |ms| ms / 1000),
                    // Ninguna ventana viva: se ofrece al abrir.
                    "pid": 0,
                });
                if std::fs::write(dir.join(format!("1x-{i}.json")), v.to_string()).is_ok() {
                    m.drafts += 1;
                }
            }
        }
    }
    let _ = std::fs::write(&mark, "1");
    Some(m)
}

/// Igual salvo los finales de línea y los espacios del final.
fn same_text(a: &str, b: &str) -> bool {
    a.replace("\r\n", "\n").trim_end() == b.replace("\r\n", "\n").trim_end()
}

/// El aviso del primer arranque.
pub(crate) fn notice(m: &Migrated) -> String {
    use iurefficient_ui::pick;
    if m.recent + m.tabs + m.drafts > 0 {
        pick(
            "Welcome to IureEditor 2.0: your recent files, tabs and drafts from 1.x are here.",
            "Bienvenido a IureEditor 2.0: aquí están tus recientes, pestañas y borradores de la 1.x.",
        )
    } else {
        pick("Welcome to IureEditor 2.0.", "Bienvenido a IureEditor 2.0.")
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brings_recent_session_and_drafts_once() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old");
        let new = dir.path().join("new");
        std::fs::create_dir_all(&old).unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        std::fs::write(&a, "# A\n").unwrap();
        std::fs::write(&b, "# B\n").unwrap();
        let gone = dir.path().join("no-existe.md");
        std::fs::write(old.join("recent.json"), serde_json::json!({"recentFiles": [a, gone, b]}).to_string()).unwrap();
        std::fs::write(
            old.join("session.json"),
            serde_json::json!({"openTabs": {"paths": [a, b], "activePath": a}}).to_string(),
        )
        .unwrap();
        std::fs::write(
            old.join("draft.json"),
            serde_json::json!({"drafts": [
                {"path": a, "markdown": "# A\r\n"},
                {"path": b, "markdown": "# B cambiado\n", "savedAt": 5000},
                {"path": null, "markdown": "sin título"},
                {"path": null, "markdown": "  "}
            ]})
            .to_string(),
        )
        .unwrap();

        let m = run_in(Some(&old), &new).unwrap();
        assert_eq!(m, Migrated { recent: 2, tabs: 2, drafts: 2 });
        let prefs = new.join("preferencias.json");
        assert_eq!(crate::drafts::load_recent(&prefs), vec![a.clone(), b.clone()]);
        assert_eq!(crate::drafts::load_session(&new.join("sesion.json")), (vec![a, b.clone()], 0));
        let drafts = crate::drafts::orphans(&new.join("borradores"));
        assert_eq!(drafts.len(), 2);
        assert!(drafts.iter().any(|(_, d)| d.path.as_deref() == Some(b.as_path()) && d.saved_at == 5));
        // Una sola vez.
        assert_eq!(run_in(Some(&old), &new), None);
        // Sin 1.x: primer arranque, nada que traer.
        assert_eq!(run_in(None, &dir.path().join("otra")), Some(Migrated::default()));
    }
}
