//! Buscar e instalar actualizaciones, como el actualizador de la 1.x: lee el `latest.json` de la
//! última versión publicada en GitHub (el mismo formato y la misma clave de firma minisign que la
//! 1.x), baja el paquete de este sistema, verifica su firma y lo instala (en otro hilo):
//!
//! - Linux: el AppImage reemplaza al que corre; el `.deb` / `.rpm` se instala con `pkexec`;
//! - Windows: el instalador NSIS en modo pasivo (cierra la app, instala y la vuelve a abrir);
//! - macOS: el `.app.tar.gz` reemplaza al `.app` que corre.
//!
//! Si no se sabe cómo se instaló (un `.tar.gz` o `cargo run`), se ofrece la página de descargas.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::time::Duration;

use iurefficient_ui::pick;

/// Dónde se publica la versión más reciente.
const LATEST: &str = "https://github.com/ellaguno/iureditor/releases/latest/download/latest.json";
/// La página de descargas.
pub(crate) const RELEASES: &str = "https://github.com/ellaguno/iureditor/releases/latest";
/// La clave pública del actualizador (la de la 1.x, `KEY_8F1B`), como en `tauri.conf.json`.
const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDhGMUI0OEUxNjg1NjE1MjUKUldRbEZWWm80VWdiajlpRzB5WFRKY0RFZ01VVGN0TVMrV01LQjZWTUNTa3JsV0VoMFRWQTlmbmUK";
/// Manifiesto más grande que se lee.
const MAX_BYTES: usize = 256 * 1024;
/// Paquete más grande que se baja.
const MAX_PACKAGE: usize = 512 * 1024 * 1024;

/// Cómo está instalada esta copia.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    AppImage(PathBuf),
    Deb,
    Rpm,
    Nsis,
    /// El `.app` que corre.
    MacApp(PathBuf),
}

impl Kind {
    /// La clave en `platforms` del `latest.json` (con la de respaldo).
    fn keys(&self) -> &'static [&'static str] {
        match self {
            Kind::AppImage(_) => &["linux-x86_64"],
            Kind::Deb => &["linux-x86_64-deb"],
            Kind::Rpm => &["linux-x86_64-rpm"],
            Kind::Nsis => &["windows-x86_64-nsis", "windows-x86_64"],
            Kind::MacApp(_) => {
                if cfg!(target_arch = "aarch64") {
                    &["darwin-aarch64-app", "darwin-aarch64"]
                } else {
                    &["darwin-x86_64-app", "darwin-x86_64"]
                }
            }
        }
    }
}

/// El paquete que instalaría esta copia.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Package {
    pub url: String,
    pub signature: String,
    pub kind: Kind,
}

/// Resultado de la búsqueda.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Check {
    /// Esta versión es la más reciente (o más nueva).
    UpToDate,
    /// Hay una versión más nueva; con su paquete si esta copia se puede actualizar sola.
    Newer(String, Option<Package>),
    /// No se pudo consultar (sin red, servidor…), en palabras para el usuario.
    Failed(String),
}

/// Resultado de la instalación.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Installed {
    /// Instalada: hay que reiniciar con esta orden.
    Restart(Relaunch),
    /// Windows: el instalador ya corre; la app debe cerrarse.
    Quit,
    Failed(String),
}

/// Cómo volver a abrir la app tras actualizar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Relaunch(PathBuf);

/// Cómo se instaló esta copia (`None`: no se sabe; se ofrece la página de descargas).
pub(crate) fn detect() -> Option<Kind> {
    let exe = std::env::current_exe().ok()?;
    if cfg!(target_os = "linux") {
        if let Some(a) = std::env::var_os("APPIMAGE").map(PathBuf::from).filter(|p| p.is_file()) {
            return Some(Kind::AppImage(a));
        }
        if exe.starts_with("/usr") {
            if Path::new("/var/lib/dpkg/info/iureditor.list").exists() {
                return Some(Kind::Deb);
            }
            let rpm = std::process::Command::new("rpm").args(["-q", "iureditor"]).output();
            if rpm.is_ok_and(|o| o.status.success()) {
                return Some(Kind::Rpm);
            }
        }
        return None;
    }
    if cfg!(windows) {
        // El instalador NSIS deja el desinstalador junto al programa.
        let dir = exe.parent()?;
        return dir.join("uninstall.exe").is_file().then_some(Kind::Nsis);
    }
    if cfg!(target_os = "macos") {
        let app = exe.parent()?.parent()?.parent()?;
        return app.extension().is_some_and(|e| e == "app").then(|| Kind::MacApp(app.to_path_buf()));
    }
    None
}

fn runtime() -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_current_thread().enable_all().build()
}

fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder().user_agent(concat!("IureEditor/", env!("CARGO_PKG_VERSION"))).build()
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
    let failed = |e: &dyn std::fmt::Display| {
        Check::Failed(format!("{} ({e})", pick("Could not check for updates", "No se pudo buscar actualizaciones")))
    };
    let rt = match runtime() {
        Ok(rt) => rt,
        Err(e) => return failed(&e),
    };
    let body = rt.block_on(async {
        let r = client()?.get(LATEST).timeout(Duration::from_secs(15)).send().await?.error_for_status()?;
        r.text().await
    });
    match body {
        Ok(b) if b.len() <= MAX_BYTES => compare(&b, env!("CARGO_PKG_VERSION"), detect()),
        Ok(_) => failed(&"respuesta muy grande"),
        Err(e) => failed(&e),
    }
}

/// Compara el `latest.json` con la versión `ours`; `kind`: cómo está instalada esta copia.
pub(crate) fn compare(latest_json: &str, ours: &str, kind: Option<Kind>) -> Check {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(latest_json) else {
        return invalid();
    };
    let Some(theirs) = v.get("version").and_then(|x| x.as_str()).map(|s| s.trim_start_matches('v').to_string()) else {
        return invalid();
    };
    if !newer(&theirs, ours) {
        return Check::UpToDate;
    }
    let pkg = kind.and_then(|kind| {
        let p = kind.keys().iter().find_map(|k| v.get("platforms")?.get(*k))?;
        let url = p.get("url")?.as_str()?.to_string();
        let signature = p.get("signature")?.as_str()?.to_string();
        url.starts_with("https://").then_some(Package { url, signature, kind })
    });
    Check::Newer(theirs, pkg)
}

fn invalid() -> Check {
    Check::Failed(
        pick("The update information is not valid.", "La información de la actualización no es válida.").to_string(),
    )
}

/// `a` es más nueva que `b` (semver: números; a igual número, la final gana a la preliminar, y
/// entre preliminares, por partes: `alpha.10` > `alpha.6`, `rc.1` > `beta.3`).
pub(crate) fn newer(a: &str, b: &str) -> bool {
    use std::cmp::Ordering;
    let parse = |s: &str| {
        let s = s.split('+').next().unwrap_or(s);
        let (core, pre) = s.split_once('-').map_or((s, None), |(c, p)| (c, Some(p.to_string())));
        let mut nums: Vec<u64> = core.split('.').take(3).map(|n| n.parse().unwrap_or(0)).collect();
        nums.resize(3, 0);
        (nums, pre)
    };
    let (na, pa) = parse(a);
    let (nb, pb) = parse(b);
    if na != nb {
        return na > nb;
    }
    let ident = |x: &str, y: &str| match (x.parse::<u64>(), y.parse::<u64>()) {
        (Ok(m), Ok(n)) => m.cmp(&n),
        (Ok(_), Err(_)) => Ordering::Less,
        (Err(_), Ok(_)) => Ordering::Greater,
        (Err(_), Err(_)) => x.cmp(y),
    };
    match (pa, pb) {
        (None, Some(_)) => true,
        (Some(x), Some(y)) => {
            let (xs, ys): (Vec<&str>, Vec<&str>) = (x.split('.').collect(), y.split('.').collect());
            for (p, q) in xs.iter().zip(&ys) {
                match ident(p, q) {
                    Ordering::Equal => {}
                    o => return o == Ordering::Greater,
                }
            }
            xs.len() > ys.len()
        }
        _ => false,
    }
}

/// Verifica la firma minisign de `data` (`signature`: el `.sig` en base64, como en la 1.x).
pub(crate) fn verify(data: &[u8], signature: &str, pubkey_b64: &str) -> Result<(), String> {
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD;
    let text =
        |s: &str| b64.decode(s.trim()).ok().and_then(|b| String::from_utf8(b).ok()).ok_or_else(|| "base64".to_string());
    let pk = minisign_verify::PublicKey::decode(&text(pubkey_b64)?).map_err(|e| e.to_string())?;
    let sig = minisign_verify::Signature::decode(&text(signature)?).map_err(|e| e.to_string())?;
    pk.verify(data, &sig, true).map_err(|e| e.to_string())
}

/// Baja, verifica e instala en otro hilo.
pub(crate) fn install(pkg: Package) -> Receiver<Installed> {
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let r = download(&pkg.url).and_then(|data| {
            verify(&data, &pkg.signature, PUBKEY).map_err(|e| {
                format!(
                    "{} ({e})",
                    pick("The update signature is not valid", "La firma de la actualización no es válida")
                )
            })?;
            apply(&pkg.kind, &data)
        });
        let _ = tx.send(r.unwrap_or_else(Installed::Failed));
    });
    rx
}

fn download(url: &str) -> Result<Vec<u8>, String> {
    let fail = |e: &dyn std::fmt::Display| format!("{} ({e})", pick("Could not download", "No se pudo descargar"));
    let rt = runtime().map_err(|e| fail(&e))?;
    rt.block_on(async {
        let mut r = client()?.get(url).timeout(Duration::from_secs(600)).send().await?.error_for_status()?;
        let mut data = Vec::new();
        while let Some(chunk) = r.chunk().await? {
            data.extend_from_slice(&chunk);
            if data.len() > MAX_PACKAGE {
                return Ok(None);
            }
        }
        Ok::<_, reqwest::Error>(Some(data))
    })
    .map_err(|e| fail(&e))?
    .ok_or_else(|| fail(&"demasiado grande"))
}

/// Un archivo temporal propio para el paquete.
fn temp_file(name: &str, data: &[u8]) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("iureditor-update-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(name);
    std::fs::write(&p, data).map_err(|e| e.to_string())?;
    Ok(p)
}

fn run(cmd: &mut std::process::Command) -> Result<(), String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().chars().take(400).collect())
    }
}

fn apply(kind: &Kind, data: &[u8]) -> Result<Installed, String> {
    let fail =
        |e: String| format!("{} ({e})", pick("Could not install the update", "No se pudo instalar la actualización"));
    match kind {
        Kind::AppImage(path) => {
            let tmp = path.with_extension("nuevo");
            std::fs::write(&tmp, data).map_err(|e| fail(e.to_string()))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| fail(e.to_string()))?;
            }
            std::fs::rename(&tmp, path).map_err(|e| fail(e.to_string()))?;
            Ok(Installed::Restart(Relaunch(path.clone())))
        }
        Kind::Deb | Kind::Rpm => {
            let deb = matches!(kind, Kind::Deb);
            let f = temp_file(if deb { "iureditor.deb" } else { "iureditor.rpm" }, data).map_err(fail)?;
            let mut cmd = std::process::Command::new("pkexec");
            if deb {
                cmd.arg("dpkg").arg("-i").arg(&f);
            } else {
                cmd.arg("rpm").arg("-U").arg("--force").arg(&f);
            }
            let r = run(&mut cmd);
            let _ = std::fs::remove_file(&f);
            r.map_err(fail)?;
            Ok(Installed::Restart(Relaunch(PathBuf::from("/usr/bin/iureditor"))))
        }
        Kind::Nsis => {
            let f = temp_file("iureditor-setup.exe", data).map_err(fail)?;
            // Pasivo y volver a abrir al terminar (como el actualizador de la 1.x).
            std::process::Command::new(&f).args(["/P", "/R"]).spawn().map_err(|e| fail(e.to_string()))?;
            Ok(Installed::Quit)
        }
        Kind::MacApp(app) => {
            let f = temp_file("iureditor.app.tar.gz", data).map_err(fail)?;
            let dir = f.parent().map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir);
            let out = dir.join("nuevo");
            let _ = std::fs::remove_dir_all(&out);
            std::fs::create_dir_all(&out).map_err(|e| fail(e.to_string()))?;
            run(std::process::Command::new("tar").arg("-xzf").arg(&f).arg("-C").arg(&out)).map_err(fail)?;
            let new_app = std::fs::read_dir(&out)
                .map_err(|e| fail(e.to_string()))?
                .flatten()
                .map(|e| e.path())
                .find(|p| p.extension().is_some_and(|e| e == "app"))
                .ok_or_else(|| fail("no .app".into()))?;
            // El viejo a un lado; si el nuevo no entra, vuelve.
            let old = dir.join("anterior.app");
            std::fs::rename(app, &old).map_err(|e| fail(e.to_string()))?;
            if let Err(e) = std::fs::rename(&new_app, app) {
                let _ = std::fs::rename(&old, app);
                return Err(fail(e.to_string()));
            }
            let _ = std::fs::remove_dir_all(&old);
            Ok(Installed::Restart(Relaunch(app.clone())))
        }
    }
}

/// Vuelve a abrir la app (ya actualizada) un momento después de que esta termine: la nueva no
/// encuentra la ventana vieja y no le pasa sus argumentos.
pub(crate) fn relaunch(r: &Relaunch) {
    let p = r.0.display().to_string().replace('\'', "'\\''");
    let script =
        if cfg!(target_os = "macos") { format!("sleep 1; open -n '{p}'") } else { format!("sleep 1; exec '{p}'") };
    let _ = std::process::Command::new("sh").arg("-c").arg(script).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_like_semver() {
        assert!(newer("2.0.1", "2.0.0"));
        assert!(newer("2.0.0", "2.0.0-alpha.3"), "la final gana a la alfa");
        assert!(newer("2.0.0-beta.1", "2.0.0-alpha.3"));
        assert!(newer("2.0.0-alpha.10", "2.0.0-alpha.6"), "por número, no por letras");
        assert!(newer("2.0.0-rc.1", "2.0.0-alpha.7"));
        assert!(newer("2.0.0-rc.1.1", "2.0.0-rc.1"));
        assert!(!newer("1.19.2", "2.0.0-alpha.3"), "la 1.x no es más nueva");
        assert!(!newer("2.0.0-alpha.3", "2.0.0-alpha.3"));
        assert!(newer("2.0.0", "1.19.2"));
        assert_eq!(compare(r#"{"version":"v2.1.0"}"#, "2.0.0", None), Check::Newer("2.1.0".into(), None));
        assert_eq!(compare(r#"{"version":"1.19.2"}"#, "2.0.0-alpha.3", None), Check::UpToDate);
        assert!(matches!(compare("no es json", "2.0.0", None), Check::Failed(_)));
    }

    #[test]
    fn picks_the_package_of_this_install() {
        let j = r#"{"version":"2.0.0","platforms":{
            "linux-x86_64":{"url":"https://x/a.AppImage","signature":"s1"},
            "linux-x86_64-deb":{"url":"https://x/a.deb","signature":"s2"},
            "windows-x86_64":{"url":"http://x/a.exe","signature":"s3"}}}"#;
        let Check::Newer(_, Some(p)) = compare(j, "1.19.2", Some(Kind::Deb)) else { panic!() };
        assert_eq!((p.url.as_str(), p.signature.as_str()), ("https://x/a.deb", "s2"));
        assert_eq!(compare(j, "1.19.2", Some(Kind::Rpm)), Check::Newer("2.0.0".into(), None));
        // Solo https.
        assert_eq!(compare(j, "1.19.2", Some(Kind::Nsis)), Check::Newer("2.0.0".into(), None));
    }

    #[test]
    fn verifies_minisign_signatures_like_the_1x_updater() {
        // Firmado con una clave de prueba (`tauri signer generate`, como la de la 1.x).
        let pk = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk3MTVERjU1QjIxMjZFNDUKUldSRmJoS3lWZDhWbDNGSEMrTk54ZldKQnk4OHd6VUpNMVNGa2ZZcUU4UDZvOW9oZTFyNnM1bG4K";
        let sig = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSRmJoS3lWZDhWbHlLRCs0OXFkN0JwYkJOMWhjdjRjWXFpa09RQWpxbG9CY25ONWpML2QxNlZIUC9MdDhzQmhSZjhrL2ZZb2IxcXEwYTRvR1J3QmZBbExGVTdWaHMxMmdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk1ODgyNDgzCWZpbGU6aG9sYS50eHQKUUVHSUhDV2hGcTFWZHRPZjJnSHdLbzZrTkpzQ2hNd3dpYlY2ek9qZUlqaDc0czhkeTFzaWdiSzI5VTZWWlIyYXBPNGMyRG5jK3dYZ1A3UlpsZ2twRHc9PQo=";
        assert_eq!(verify(b"hola", sig, pk), Ok(()));
        assert!(verify(b"hola!", sig, pk).is_err(), "otro contenido");
        assert!(verify(b"hola", sig, PUBKEY).is_err(), "otra clave");
        assert!(verify(b"hola", "no-es-base64!!", PUBKEY).is_err());
    }
}
