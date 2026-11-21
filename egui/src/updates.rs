//! Ayuda › Buscar actualizaciones: lee el `latest.json` de la última versión publicada en GitHub
//! (el mismo que usaba el actualizador de la 1.x) en otro hilo y lo compara con esta versión. Si
//! hay una más nueva se ofrece su página para descargarla.

use std::sync::mpsc::{Receiver, channel};
use std::time::Duration;

/// Dónde se publica la versión más reciente.
const LATEST: &str = "https://github.com/ellaguno/iureditor/releases/latest/download/latest.json";
/// La página de descargas.
pub(crate) const RELEASES: &str = "https://github.com/ellaguno/iureditor/releases/latest";
/// Respuesta más grande que se lee.
const MAX_BYTES: usize = 256 * 1024;

/// Resultado de la búsqueda.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Check {
    /// Esta versión es la más reciente (o más nueva).
    UpToDate,
    /// Hay una versión más nueva.
    Newer(String),
    /// No se pudo consultar (sin red, servidor…), en palabras para el usuario.
    Failed(String),
}

/// Busca en otro hilo; el resultado llega por el canal.
pub(crate) fn start() -> Receiver<Check> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let _ = tx.send(fetch());
    });
    rx
}

fn fetch() -> Check {
    use iurefficient_ui::pick;
    let failed = |e: &dyn std::fmt::Display| {
        Check::Failed(format!("{} ({e})", pick("Could not check for updates", "No se pudo buscar actualizaciones")))
    };
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => return failed(&e),
    };
    let body = rt.block_on(async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("IureEditor/", env!("CARGO_PKG_VERSION")))
            .build()?;
        let r = client.get(LATEST).send().await?.error_for_status()?;
        r.text().await
    });
    match body {
        Ok(b) if b.len() <= MAX_BYTES => compare(&b, env!("CARGO_PKG_VERSION")),
        Ok(_) => failed(&"respuesta muy grande"),
        Err(e) => failed(&e),
    }
}

/// Compara el `latest.json` con la versión `ours`.
pub(crate) fn compare(latest_json: &str, ours: &str) -> Check {
    let v = serde_json::from_str::<serde_json::Value>(latest_json)
        .ok()
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.trim_start_matches('v').to_string()));
    match v {
        Some(theirs) if newer(&theirs, ours) => Check::Newer(theirs),
        Some(_) => Check::UpToDate,
        None => Check::Failed(
            iurefficient_ui::pick(
                "The update information is not valid.",
                "La información de la actualización no es válida.",
            )
            .to_string(),
        ),
    }
}

/// `a` es más nueva que `b` (semver: números y, a igual número, sin «-alpha» gana).
fn newer(a: &str, b: &str) -> bool {
    let parse = |s: &str| {
        let (core, pre) = s.split_once('-').map_or((s, None), |(c, p)| (c, Some(p.to_string())));
        let nums: Vec<u64> = core.split('.').take(3).map(|n| n.parse().unwrap_or(0)).collect();
        (nums, pre)
    };
    let (na, pa) = parse(a);
    let (nb, pb) = parse(b);
    if na != nb {
        return na > nb;
    }
    match (pa, pb) {
        (None, Some(_)) => true,
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_like_semver() {
        assert!(newer("2.0.1", "2.0.0"));
        assert!(newer("2.0.0", "2.0.0-alpha.3"), "la final gana a la alfa");
        assert!(newer("2.0.0-beta.1", "2.0.0-alpha.3"));
        assert!(!newer("1.19.2", "2.0.0-alpha.3"), "la 1.x no es más nueva");
        assert!(!newer("2.0.0-alpha.3", "2.0.0-alpha.3"));
        assert_eq!(compare(r#"{"version":"v2.1.0"}"#, "2.0.0"), Check::Newer("2.1.0".into()));
        assert_eq!(compare(r#"{"version":"1.19.2"}"#, "2.0.0-alpha.3"), Check::UpToDate);
        assert!(matches!(compare("no es json", "2.0.0"), Check::Failed(_)));
    }
}
