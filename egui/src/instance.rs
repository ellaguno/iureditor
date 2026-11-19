//! Una sola ventana: un segundo `iureditor2` (abierto por el sistema con un `.md` o un enlace
//! `iureditor://`, o por IureVoz al dictar) le pasa sus argumentos a la ventana abierta y termina.
//! Es lo que hacía el complemento *single-instance* de la versión Tauri.
//!
//! Transporte como el puente de IureDesk: socket Unix en Linux y macOS; en Windows (sin `AF_UNIX`
//! en `std` ni tuberías con nombre sin `unsafe`) TCP en `127.0.0.1` con puerto efímero. Un archivo
//! `instancia.json` en la carpeta de ejecución del usuario (0600, carpeta 0700) dice dónde escuchar
//! y lleva un **token** de 256 bits; cada conexión manda una línea
//! `{"v":1,"token":…,"open":["…"]}` y recibe `{"ok":true}`. Tamaños acotados y tiempos de espera.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{Value, json};

const MAX_REQUEST: u64 = 1024 * 1024;
const MAX_ARGS: usize = 64;
const MAX_ARG_LEN: usize = 96 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Carpeta de ejecución: `IUREDITOR_RUNTIME_DIR`, `$XDG_RUNTIME_DIR/iureditor2` o la caché.
pub fn runtime_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("IUREDITOR_RUNTIME_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(d));
    }
    dirs::runtime_dir().or_else(dirs::cache_dir).map(|d| d.join("iureditor2"))
}

fn endpoint_file(dir: &Path) -> PathBuf {
    dir.join("instancia.json")
}

fn new_token() -> Option<String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).ok()?;
    Some(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// Comparación en tiempo constante.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn private_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(&tmp)?;
    f.write_all(data)?;
    drop(f);
    std::fs::rename(&tmp, path)
}

// ------------------------------------------------------------------ transporte

#[derive(Clone, Debug)]
enum Endpoint {
    #[cfg(unix)]
    Unix(PathBuf),
    #[cfg(not(unix))]
    Tcp(std::net::SocketAddr),
}

trait Stream: Read + Write {}
impl<T: Read + Write> Stream for T {}

/// Acepta la siguiente conexión.
type Accept = Box<dyn FnMut() -> std::io::Result<Box<dyn Stream>> + Send>;

impl Endpoint {
    fn connect(&self) -> std::io::Result<Box<dyn Stream>> {
        match self {
            #[cfg(unix)]
            Endpoint::Unix(p) => {
                let s = std::os::unix::net::UnixStream::connect(p)?;
                s.set_read_timeout(Some(IO_TIMEOUT))?;
                s.set_write_timeout(Some(IO_TIMEOUT))?;
                Ok(Box::new(s))
            }
            #[cfg(not(unix))]
            Endpoint::Tcp(a) => {
                let s = std::net::TcpStream::connect_timeout(a, IO_TIMEOUT)?;
                s.set_read_timeout(Some(IO_TIMEOUT))?;
                s.set_write_timeout(Some(IO_TIMEOUT))?;
                Ok(Box::new(s))
            }
        }
    }

    fn to_json(&self) -> Value {
        match self {
            #[cfg(unix)]
            Endpoint::Unix(p) => json!({ "unix": p }),
            #[cfg(not(unix))]
            Endpoint::Tcp(a) => json!({ "tcp": a.to_string() }),
        }
    }

    fn from_json(v: &Value) -> Option<Endpoint> {
        #[cfg(unix)]
        {
            v.get("unix").and_then(Value::as_str).map(|p| Endpoint::Unix(PathBuf::from(p)))
        }
        #[cfg(not(unix))]
        {
            v.get("tcp").and_then(Value::as_str).and_then(|a| a.parse().ok()).map(Endpoint::Tcp)
        }
    }
}

fn read_line(s: &mut dyn Read) -> Option<Value> {
    let mut line = String::new();
    BufReader::new(s.take(MAX_REQUEST)).read_line(&mut line).ok()?;
    serde_json::from_str(line.trim()).ok()
}

/// Pasa `args` a la ventana abierta. `true` si la había y los recibió.
pub fn forward(dir: &Path, args: &[String]) -> bool {
    let Ok(raw) = std::fs::read_to_string(endpoint_file(dir)) else { return false };
    let Ok(info) = serde_json::from_str::<Value>(&raw) else { return false };
    let (Some(ep), Some(token)) = (Endpoint::from_json(&info), info.get("token").and_then(Value::as_str)) else {
        return false;
    };
    let Ok(mut s) = ep.connect() else { return false };
    let args: Vec<&String> = args.iter().take(MAX_ARGS).filter(|a| a.len() <= MAX_ARG_LEN).collect();
    let req = json!({ "v": 1, "token": token, "open": args });
    if writeln!(s, "{req}").is_err() || s.flush().is_err() {
        return false;
    }
    read_line(&mut s).and_then(|v| v.get("ok").and_then(Value::as_bool)).unwrap_or(false)
}

/// La escucha de la ventana abierta; se detiene al soltarla.
pub struct Listener {
    stop: Arc<AtomicBool>,
    endpoint: Endpoint,
    file: PathBuf,
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_file(&self.file);
        // Despierta al `accept`.
        let _ = self.endpoint.connect();
        #[cfg(unix)]
        {
            let Endpoint::Unix(p) = &self.endpoint;
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Empieza a escuchar; `on_open` recibe los argumentos de cada segundo `iureditor2` (lista vacía:
/// solo traer la ventana al frente).
pub fn listen(dir: &Path, on_open: impl Fn(Vec<String>) + Send + 'static) -> std::io::Result<Listener> {
    private_dir(dir)?;
    let token = new_token().ok_or_else(|| std::io::Error::other("sin azar"))?;
    #[cfg(unix)]
    let (accept, endpoint): (Accept, Endpoint) = {
        let sock = dir.join("instancia.sock");
        let _ = std::fs::remove_file(&sock);
        let l = std::os::unix::net::UnixListener::bind(&sock)?;
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&sock, std::fs::Permissions::from_mode(0o600))?;
        }
        (
            Box::new(move || {
                let (s, _) = l.accept()?;
                s.set_read_timeout(Some(IO_TIMEOUT))?;
                s.set_write_timeout(Some(IO_TIMEOUT))?;
                Ok(Box::new(s) as Box<dyn Stream>)
            }),
            Endpoint::Unix(sock),
        )
    };
    #[cfg(not(unix))]
    let (accept, endpoint): (Accept, Endpoint) = {
        let l = std::net::TcpListener::bind(("127.0.0.1", 0))?;
        let addr = l.local_addr()?;
        (
            Box::new(move || {
                let (s, _) = l.accept()?;
                s.set_read_timeout(Some(IO_TIMEOUT))?;
                s.set_write_timeout(Some(IO_TIMEOUT))?;
                Ok(Box::new(s) as Box<dyn Stream>)
            }),
            Endpoint::Tcp(addr),
        )
    };
    let mut info = endpoint.to_json();
    if let Some(o) = info.as_object_mut() {
        o.insert("v".into(), json!(1));
        o.insert("token".into(), json!(token));
        o.insert("pid".into(), json!(std::process::id()));
    }
    let file = endpoint_file(dir);
    write_private(&file, info.to_string().as_bytes())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let mut accept = accept;
    std::thread::Builder::new().name("iureditor-instancia".into()).spawn(move || {
        loop {
            let conn = accept();
            if stop2.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut s) = conn else {
                std::thread::sleep(Duration::from_millis(50));
                continue;
            };
            // De uno en uno: cada conexión es breve y acotada por los tiempos de espera.
            let req = read_line(&mut s);
            let ok = req.as_ref().is_some_and(|r| {
                r.get("v").and_then(Value::as_u64) == Some(1)
                    && r.get("token").and_then(Value::as_str).is_some_and(|t| same(t, &token))
            });
            if ok {
                let args: Vec<String> = req
                    .as_ref()
                    .and_then(|r| r.get("open"))
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_str)
                            .filter(|s| s.len() <= MAX_ARG_LEN)
                            .take(MAX_ARGS)
                            .map(String::from)
                            .collect()
                    })
                    .unwrap_or_default();
                on_open(args);
            }
            let _ = writeln!(s, "{}", json!({ "ok": ok }));
        }
    })?;
    Ok(Listener { stop, endpoint, file })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_instance_hands_over_its_arguments() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("run");
        assert!(!forward(&dir, &["/tmp/a.md".into()]), "sin ventana abierta");
        let (tx, rx) = std::sync::mpsc::channel();
        let l = listen(&dir, move |a| {
            let _ = tx.send(a);
        })
        .unwrap();
        assert!(forward(&dir, &["/tmp/a.md".into(), "iureditor://insert?text=x".into()]));
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), ["/tmp/a.md", "iureditor://insert?text=x"]);
        // Sin el token: rechazado.
        let info: Value = serde_json::from_str(&std::fs::read_to_string(endpoint_file(&dir)).unwrap()).unwrap();
        let mut s = Endpoint::from_json(&info).unwrap().connect().unwrap();
        writeln!(s, "{}", json!({"v": 1, "token": "0".repeat(64), "open": ["/etc/passwd"]})).unwrap();
        assert_eq!(read_line(&mut s).unwrap()["ok"], false);
        assert!(rx.recv_timeout(Duration::from_millis(200)).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(endpoint_file(&dir)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        drop(l);
        assert!(!forward(&dir, &[]), "al cerrar ya no hay a quién pasarle");
    }
}
