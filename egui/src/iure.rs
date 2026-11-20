//! Pestaña **Iurefficient** del panel lateral, como IureEditor 1.x: conectar la cuenta (o tomar la
//! sesión que dejó otra app de la suite), buscar proyectos, abrir sus documentos de texto como copias
//! locales («espejos») y subir lo guardado como versión nueva, o guardar un documento como nuevo en
//! un proyecto.
//!
//! Todo lo de red va por `iurefficient-connect` en un hilo propio con tokio; la interfaz manda
//! [`Req`] y recoge [`Rep`] sin bloquearse. La sesión (cookies, nunca la contraseña) va al llavero
//! del sistema con los mismos nombres que el resto de la suite (servicio `iurefficient`, usuario
//! `host:correo:session`), y la cuenta activa a `cuenta-activa.json`: así IureDesk, IureProject e
//! IureDav entran solos tras conectar aquí, y al revés.
//!
//! Los espejos se recuerdan en `<datos>/iurefficient.json` (`ruta local → proyecto y documento`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::Duration;

use egui::{RichText, Sense, Ui, vec2};
use iurefficient_connect::api::{CaseSummary, Document};
use iurefficient_ui::icons::{self, Icon};
use iurefficient_ui::{pick, theme};
use serde::{Deserialize, Serialize};

/// Servicio compartido del llavero de la suite.
const SHARED_SERVICE: &str = "iurefficient";
/// Con quién se anuncia la app (User-Agent y cuenta activa).
const APP: &str = "iureditor";
/// Tiempo máximo de cada petición (descargas incluidas).
const TIMEOUT: Duration = Duration::from_secs(90);
/// Espera tras teclear en la búsqueda de proyectos (como la 1.x).
const DEBOUNCE: f64 = 0.3;
/// Proyectos que se piden.
const MAX_CASES: u32 = 50;

/// Un documento de Iurefficient abierto como archivo local.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Mirror {
    /// `None`: «General» (sin proyecto).
    pub case_id: Option<String>,
    pub case_title: String,
    pub document_id: String,
    pub file_name: String,
}

/// Lo que se guarda en `iurefficient.json`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    domain: String,
    #[serde(default)]
    email: String,
    /// Subir versión al guardar (Ctrl+S); por omisión, sí.
    #[serde(default)]
    autosync: Option<bool>,
    #[serde(default)]
    mirrors: BTreeMap<String, Mirror>,
}

/// Estado de la conexión.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Status {
    Checking,
    LoggedOut,
    /// La cuenta pide el código de verificación en dos pasos.
    Totp {
        token: String,
    },
    Ready {
        name: String,
        email: String,
        host: String,
        case_label: String,
    },
}

/// Lo que se pide al hilo de red.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Req {
    /// Retomar la sesión compartida de la suite.
    Restore,
    Login {
        domain: String,
        email: String,
        password: String,
    },
    Totp {
        token: String,
        code: String,
    },
    Logout,
    Cases(String),
    Docs(String),
    Open {
        case_id: Option<String>,
        case_title: String,
        doc_id: String,
        file_name: String,
    },
    Upload {
        path: PathBuf,
        mirror: Mirror,
    },
    SaveNew {
        path: PathBuf,
        case_id: Option<String>,
        case_title: String,
    },
}

/// Lo que responde.
#[derive(Clone, Debug)]
pub(crate) enum Rep {
    /// Estado nuevo; con `LoggedOut`, la cuenta para rellenar el formulario y el motivo.
    Status {
        status: Status,
        account: Option<(String, String)>,
        error: Option<String>,
    },
    Cases {
        query: String,
        cases: Vec<CaseSummary>,
    },
    Docs {
        case_id: String,
        docs: Vec<Doc>,
    },
    Opened {
        path: PathBuf,
        mirror: Mirror,
    },
    Uploaded {
        path: PathBuf,
    },
    SavedNew {
        path: PathBuf,
        mirror: Mirror,
    },
    Error(String),
}

/// Un documento de un proyecto, con si se puede editar aquí.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Doc {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub editable: bool,
}

/// Lo que el panel pide a la app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum IureAct {
    /// Abrir este archivo (el espejo recién descargado).
    Open(PathBuf),
    /// Guardar el documento activo y subirlo como versión.
    SaveAndUpload,
    /// Guardar el documento activo como documento nuevo en este proyecto (`None`: General).
    SaveNew { case_id: Option<String>, case_title: String },
}

/// ¿Se puede editar aquí? (Markdown y texto, como la 1.x.)
fn editable(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .is_some_and(|e| matches!(e.as_str(), "md" | "markdown" | "txt"))
}

/// Nombre de archivo seguro (sin separadores ni caracteres reservados), acotado.
pub(crate) fn safe_name(name: &str) -> String {
    let s: String =
        name.chars()
            .map(|c| {
                if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
                    '_'
                } else {
                    c
                }
            })
            .take(150)
            .collect();
    let s = s.trim().trim_start_matches('.').to_string();
    if s.is_empty() { "documento.md".to_string() } else { s }
}

/// Dónde vive el espejo de un documento.
pub(crate) fn mirror_path(base: &Path, case_id: Option<&str>, doc_id: &str, file_name: &str) -> PathBuf {
    base.join("iurefficient")
        .join(safe_name(case_id.unwrap_or("general")))
        .join(safe_name(doc_id))
        .join(safe_name(file_name))
}

/// Documentos: primero los editables, luego por título.
fn sort_docs(docs: Vec<Document>) -> Vec<Doc> {
    let mut out: Vec<Doc> = docs
        .into_iter()
        .take(2_000)
        .map(|d| {
            let name = if d.file_name.is_empty() { d.title.clone() } else { d.file_name.clone() };
            Doc { editable: editable(&name), id: d.id, title: d.title, file_name: name }
        })
        .collect();
    out.sort_by(|a, b| b.editable.cmp(&a.editable).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    out
}

// --- Hilo de red ---

fn entry(acc: &iurefficient_connect::Account) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SHARED_SERVICE, &format!("{}:{}:session", acc.host(), acc.email)).map_err(|e| e.to_string())
}

fn human(e: &anyhow::Error) -> String {
    let s = format!("{e:#}");
    if s.contains("error sending request") || s.contains("dns error") || s.contains("connect") {
        pick(
            "Could not reach Iurefficient. Check the domain and your connection.",
            "No se pudo conectar con Iurefficient. Revisa el dominio y tu conexión.",
        )
        .to_string()
    } else {
        s
    }
}

struct Worker {
    data: Option<PathBuf>,
    session: Option<iurefficient_connect::rest::Session>,
    /// Sesión a medio abrir mientras se espera el código TOTP.
    pending: Option<iurefficient_connect::rest::Session>,
}

impl Worker {
    fn user_agent() -> String {
        iurefficient_connect::user_agent("IureEditor", env!("CARGO_PKG_VERSION"))
    }

    fn logged_out(acc: Option<(String, String)>, error: Option<String>) -> Rep {
        Rep::Status { status: Status::LoggedOut, account: acc, error }
    }

    /// Deja la sesión lista: la guarda en el llavero, marca la cuenta activa y lee la terminología.
    async fn ready(
        &mut self,
        sess: iurefficient_connect::rest::Session,
        user: iurefficient_connect::rest::User,
    ) -> Rep {
        let acc = sess.account().clone();
        if let (Ok(json), Ok(e)) = (serde_json::to_string(&sess.export()), entry(&acc)) {
            let _ = e.set_password(&json);
        }
        let _ = iurefficient_connect::account::set_active(&acc, APP);
        let case_label = match iurefficient_connect::api::terminology(&sess).await {
            Ok(t) => t.case,
            Err(_) => pick("project", "proyecto").to_string(),
        };
        let name = user.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| user.email.clone());
        let email = if user.email.is_empty() { acc.email.clone() } else { user.email };
        self.session = Some(sess);
        Rep::Status { status: Status::Ready { name, email, host: acc.host(), case_label }, account: None, error: None }
    }

    async fn handle(&mut self, req: Req) -> Rep {
        use iurefficient_connect::rest::{Login, Session, SessionExport};
        match req {
            Req::Restore => {
                let Some(active) = iurefficient_connect::account::active() else { return Self::logged_out(None, None) };
                let Ok(acc) = active.account() else { return Self::logged_out(None, None) };
                let who = Some((active.domain.clone(), active.email.clone()));
                let saved = entry(&acc)
                    .ok()
                    .and_then(|e| e.get_password().ok())
                    .and_then(|j| serde_json::from_str::<SessionExport>(&j).ok())
                    .filter(|s| !s.cookies.is_empty());
                let Some(saved) = saved else { return Self::logged_out(who, None) };
                let sess = match Session::new(acc, &Self::user_agent()) {
                    Ok(s) => s,
                    Err(e) => return Self::logged_out(who, Some(human(&e))),
                };
                match sess.import(&saved).await {
                    Ok(user) => self.ready(sess, user).await,
                    Err(_) => Self::logged_out(
                        who,
                        Some(pick("The session expired: sign in again.", "La sesión caducó: vuelve a entrar.").into()),
                    ),
                }
            }
            Req::Login { domain, email, password } => {
                let who = Some((domain.clone(), email.clone()));
                let acc = match iurefficient_connect::Account::new(domain.trim(), email.trim()) {
                    Ok(a) => a,
                    Err(e) => return Self::logged_out(who, Some(human(&e))),
                };
                let sess = match Session::new(acc, &Self::user_agent()) {
                    Ok(s) => s,
                    Err(e) => return Self::logged_out(who, Some(human(&e))),
                };
                match sess.login(&password).await {
                    Ok(Login::Ok(user)) => self.ready(sess, user).await,
                    Ok(Login::TotpRequired { totp_token }) => {
                        self.pending = Some(sess);
                        Rep::Status { status: Status::Totp { token: totp_token }, account: None, error: None }
                    }
                    Err(e) => Self::logged_out(who, Some(human(&e))),
                }
            }
            Req::Totp { token, code } => {
                let Some(sess) = self.pending.take() else { return Self::logged_out(None, None) };
                match sess.verify_totp(&token, code.trim()).await {
                    Ok(user) => self.ready(sess, user).await,
                    Err(e) => {
                        let err = human(&e);
                        self.pending = Some(sess);
                        Rep::Status { status: Status::Totp { token }, account: None, error: Some(err) }
                    }
                }
            }
            Req::Logout => {
                if let Some(sess) = self.session.take() {
                    let acc = sess.account().clone();
                    let _ = sess.logout().await;
                    let _ = iurefficient_connect::account::clear_active(&acc);
                    if let Ok(e) = entry(&acc) {
                        let _ = e.delete_credential();
                    }
                    return Self::logged_out(Some((acc.host(), acc.email.clone())), None);
                }
                Self::logged_out(None, None)
            }
            Req::Cases(q) => match &self.session {
                Some(s) => match iurefficient_connect::api::cases(s, Some(&q), MAX_CASES).await {
                    Ok(cases) => Rep::Cases { query: q, cases },
                    Err(e) => Rep::Error(human(&e)),
                },
                None => Self::logged_out(None, None),
            },
            Req::Docs(case_id) => match &self.session {
                Some(s) => match iurefficient_connect::api::documents_of_case(s, &case_id).await {
                    Ok(d) => Rep::Docs { case_id, docs: sort_docs(d) },
                    Err(e) => Rep::Error(human(&e)),
                },
                None => Self::logged_out(None, None),
            },
            Req::Open { case_id, case_title, doc_id, file_name } => {
                let (Some(s), Some(base)) = (&self.session, &self.data) else {
                    return Rep::Error(pick("Not connected.", "Sin conexión.").into());
                };
                let path = mirror_path(base, case_id.as_deref(), &doc_id, &file_name);
                if let Some(dir) = path.parent()
                    && let Err(e) = std::fs::create_dir_all(dir)
                {
                    return Rep::Error(e.to_string());
                }
                match iurefficient_connect::api::download_document(s, &doc_id, &path).await {
                    Ok(_) => {
                        Rep::Opened { path, mirror: Mirror { case_id, case_title, document_id: doc_id, file_name } }
                    }
                    Err(e) => Rep::Error(human(&e)),
                }
            }
            Req::Upload { path, mirror } => {
                let Some(s) = &self.session else { return Self::logged_out(None, None) };
                let opts = iurefficient_connect::api::UploadOptions {
                    case_id: mirror.case_id.clone(),
                    as_version_of: Some(mirror.document_id.clone()),
                    file_name: Some(mirror.file_name.clone()),
                    tags: vec![APP.to_string()],
                    ..Default::default()
                };
                match iurefficient_connect::api::upload_document(s, &path, &opts).await {
                    Ok(_) => Rep::Uploaded { path },
                    Err(e) => Rep::Error(human(&e)),
                }
            }
            Req::SaveNew { path, case_id, case_title } => {
                let Some(s) = &self.session else { return Self::logged_out(None, None) };
                let opts = iurefficient_connect::api::UploadOptions {
                    case_id: case_id.clone(),
                    tags: vec![APP.to_string()],
                    ..Default::default()
                };
                match iurefficient_connect::api::upload_document(s, &path, &opts).await {
                    Ok(d) => {
                        let file_name = if d.file_name.is_empty() {
                            path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
                        } else {
                            d.file_name
                        };
                        Rep::SavedNew { path, mirror: Mirror { case_id, case_title, document_id: d.id, file_name } }
                    }
                    Err(e) => Rep::Error(human(&e)),
                }
            }
        }
    }
}

/// Arranca el hilo de red.
fn spawn(ctx: egui::Context, data: Option<PathBuf>) -> (Sender<Req>, Receiver<Rep>) {
    let (tx, rx) = channel::<Req>();
    let (rtx, rrx) = channel::<Rep>();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                let _ = rtx.send(Rep::Error(e.to_string()));
                return;
            }
        };
        let mut w = Worker { data, session: None, pending: None };
        while let Ok(req) = rx.recv() {
            let rep = match rt.block_on(async { tokio::time::timeout(TIMEOUT, w.handle(req)).await }) {
                Ok(r) => r,
                Err(_) => Rep::Error(
                    pick("Iurefficient took too long to answer.", "Iurefficient tardó demasiado en responder.").into(),
                ),
            };
            if rtx.send(rep).is_err() {
                break;
            }
            ctx.request_repaint();
        }
    });
    (tx, rrx)
}

// --- Panel ---

#[derive(Default)]
pub(crate) struct IurePanel {
    link: Option<(Sender<Req>, Receiver<Rep>)>,
    pub status: Option<Status>,
    pub domain: String,
    pub email: String,
    pub password: String,
    pub code: String,
    busy: bool,
    error: Option<String>,
    /// Aviso de la última subida: (bien, texto).
    notice: Option<(bool, String)>,
    pub query: String,
    /// Búsqueda pendiente y cuándo se tecleó.
    typed: Option<f64>,
    asked: Option<String>,
    pub cases: Vec<CaseSummary>,
    pub case: Option<CaseSummary>,
    pub docs: Option<Vec<Doc>>,
    /// «Guardar en Iurefficient…» desplegado.
    targets: bool,
    store: Store,
    store_path: Option<PathBuf>,
    data: Option<PathBuf>,
    /// Para despertar la ventana cuando responde la red (se toma al dibujar el panel).
    ctx: Option<egui::Context>,
}

impl IurePanel {
    /// Con la carpeta de datos de la app (espejos y `iurefficient.json`).
    pub(crate) fn new(data: Option<PathBuf>) -> Self {
        let store_path = data.as_ref().map(|d| d.join("iurefficient.json"));
        let store: Store = store_path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        IurePanel {
            domain: store.domain.clone(),
            email: store.email.clone(),
            store,
            store_path,
            data,
            ..Default::default()
        }
    }

    /// Con un canal hecho a mano (pruebas: hacen de servidor).
    #[cfg(test)]
    pub(crate) fn with_link(data: Option<PathBuf>, tx: Sender<Req>, rx: Receiver<Rep>) -> Self {
        let mut p = Self::new(data);
        p.link = Some((tx, rx));
        p
    }

    fn send(&mut self, req: Req) {
        if self.link.is_none() {
            let Some(ctx) = self.ctx.clone() else { return };
            if cfg!(test) {
                return;
            }
            self.link = Some(spawn(ctx, self.data.clone()));
        }
        if let Some((tx, _)) = &self.link
            && tx.send(req).is_ok()
        {
            self.busy = true;
        }
    }

    fn save_store(&self) {
        if let (Some(p), Ok(json)) = (&self.store_path, serde_json::to_string_pretty(&self.store)) {
            if let Some(d) = p.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(p, json);
        }
    }

    fn key(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    /// El espejo de un archivo local, si lo es.
    pub(crate) fn mirror_of(&self, path: &Path) -> Option<&Mirror> {
        self.store.mirrors.get(&Self::key(path))
    }

    pub(crate) fn autosync(&self) -> bool {
        self.store.autosync.unwrap_or(true)
    }

    /// Tras guardar en disco: si es un espejo y está activo «subir al guardar», sube la versión.
    pub(crate) fn after_save(&mut self, path: &Path) {
        if !self.autosync() || !matches!(self.status, Some(Status::Ready { .. })) {
            return;
        }
        self.upload(path);
    }

    /// Sube `path` como versión de su documento (si es un espejo).
    pub(crate) fn upload(&mut self, path: &Path) {
        if let Some(m) = self.mirror_of(path).cloned() {
            self.send(Req::Upload { path: path.to_path_buf(), mirror: m });
        }
    }

    /// Sube `path` como documento nuevo en el proyecto.
    pub(crate) fn save_new(&mut self, path: &Path, case_id: Option<String>, case_title: String) {
        self.send(Req::SaveNew { path: path.to_path_buf(), case_id, case_title });
    }

    /// Recoge las respuestas del hilo de red.
    pub(crate) fn poll(&mut self) -> Option<IureAct> {
        let mut act = None;
        let reps: Vec<Rep> = match &self.link {
            Some((_, rx)) => rx.try_iter().take(50).collect(),
            None => Vec::new(),
        };
        for rep in reps {
            self.busy = false;
            match rep {
                Rep::Status { status, account, error } => {
                    if let Some((d, e)) = account {
                        self.domain = d;
                        self.email = e;
                    }
                    if let Status::Ready { host, email, .. } = &status {
                        self.store.domain = host.clone();
                        self.store.email = email.clone();
                        self.password.clear();
                        self.code.clear();
                        self.save_store();
                        self.asked = None;
                        self.typed = Some(f64::NEG_INFINITY);
                    }
                    if status == Status::LoggedOut {
                        self.cases.clear();
                        self.case = None;
                        self.docs = None;
                    }
                    self.status = Some(status);
                    self.error = error;
                }
                Rep::Cases { query, cases } => {
                    if query == self.query.trim() {
                        self.cases = cases;
                    }
                }
                Rep::Docs { case_id, docs } => {
                    if self.case.as_ref().is_some_and(|c| c.id == case_id) {
                        self.docs = Some(docs);
                    }
                }
                Rep::Opened { path, mirror } => {
                    self.store.mirrors.insert(Self::key(&path), mirror);
                    self.save_store();
                    act = Some(IureAct::Open(path));
                }
                Rep::Uploaded { path } => {
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    self.notice = Some((
                        true,
                        format!(
                            "{} ({name})",
                            pick("Version uploaded to Iurefficient", "Versión subida a Iurefficient")
                        ),
                    ));
                }
                Rep::SavedNew { path, mirror } => {
                    let target = if mirror.case_id.is_some() {
                        mirror.case_title.clone()
                    } else {
                        pick("General", "General").to_string()
                    };
                    self.store.mirrors.insert(Self::key(&path), mirror);
                    self.save_store();
                    self.targets = false;
                    self.notice = Some((
                        true,
                        format!(
                            "{} {target} {}",
                            pick("Saved to", "Guardado en"),
                            pick("as a new document", "como documento nuevo")
                        ),
                    ));
                }
                Rep::Error(e) => self.notice = Some((false, e)),
            }
        }
        act
    }

    fn case_label(&self) -> String {
        match &self.status {
            Some(Status::Ready { case_label, .. }) if !case_label.is_empty() => case_label.clone(),
            _ => pick("project", "proyecto").to_string(),
        }
    }

    /// La pestaña. `doc`: archivo del documento activo.
    pub(crate) fn show(&mut self, ui: &mut Ui, doc: Option<&Path>) -> Option<IureAct> {
        let ctx = ui.ctx().clone();
        self.ctx = Some(ctx.clone());
        if self.status.is_none() {
            self.status = Some(Status::Checking);
            self.send(Req::Restore);
        }
        let c = theme::colors(ui);
        let mut act = None;
        match self.status.clone().unwrap_or(Status::Checking) {
            Status::Checking => {
                ui.label(
                    RichText::new(pick("Checking the connection…", "Comprobando la conexión…")).color(c.text_muted),
                );
            }
            Status::LoggedOut | Status::Totp { .. } => self.login_form(ui),
            Status::Ready { name, email, host, .. } => {
                ui.horizontal(|ui| {
                    ui.label(RichText::new(&name).strong().color(c.text)).on_hover_text(format!("{email} · {host}"));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if icons::icon_button(ui, Icon::Close, pick("Sign out", "Cerrar sesión"), !self.busy).clicked()
                        {
                            self.send(Req::Logout);
                        }
                    });
                });
                ui.separator();
                act = self.active_doc(ui, doc);
                ui.separator();
                self.browser(ui);
            }
        }
        act
    }

    fn login_form(&mut self, ui: &mut Ui) {
        let c = theme::colors(ui);
        let totp = match &self.status {
            Some(Status::Totp { token }) => Some(token.clone()),
            _ => None,
        };
        ui.label(
            RichText::new(format!(
                "{} {}{} {}",
                pick("Connect your account to open documents from your", "Conecta tu cuenta para abrir documentos de tus"),
                self.case_label(),
                "s",
                pick(
                    "and save them as versions. The password is not stored; only the session, in the system keychain.",
                    "y guardarlos como versiones. La contraseña no se guarda; sólo la sesión, en el llavero del sistema."
                )
            ))
            .small()
            .color(c.text_muted),
        );
        ui.add_space(4.0);
        let field = |ui: &mut Ui, v: &mut String, hint: &str, password: bool| {
            let r =
                ui.add(egui::TextEdit::singleline(v).hint_text(hint).password(password).desired_width(f32::INFINITY));
            r.widget_info(|| egui::WidgetInfo::labeled(egui::Role::TextInput, true, hint));
            r
        };
        let enabled = totp.is_none() && !self.busy;
        ui.add_enabled_ui(enabled, |ui| {
            field(
                ui,
                &mut self.domain,
                pick("Domain (e.g. 2.ds.iurefficient.com)", "Dominio (p. ej. 2.ds.iurefficient.com)"),
                false,
            );
            field(ui, &mut self.email, pick("Email", "Correo"), false);
        });
        let secret = if totp.is_some() {
            field(ui, &mut self.code, pick("Verification code (6 digits)", "Código de verificación (6 dígitos)"), false)
        } else {
            field(ui, &mut self.password, pick("Iurefficient password", "Contraseña de Iurefficient"), true)
        };
        let ready = !self.domain.trim().is_empty()
            && !self.email.trim().is_empty()
            && if totp.is_some() { self.code.trim().len() >= 6 } else { !self.password.is_empty() };
        let enter = secret.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        let label = if totp.is_some() { pick("Verify", "Verificar") } else { pick("Connect", "Conectar") };
        let go = ui
            .add_enabled(ready && !self.busy, egui::Button::new(RichText::new(label).color(c.on_accent)).fill(c.accent))
            .clicked();
        if self.busy {
            ui.add(egui::Spinner::new().size(12.0));
        }
        if (go || enter) && ready && !self.busy {
            let req = match totp {
                Some(token) => Req::Totp { token, code: self.code.clone() },
                None => Req::Login {
                    domain: self.domain.clone(),
                    email: self.email.clone(),
                    password: std::mem::take(&mut self.password),
                },
            };
            self.send(req);
        }
        if let Some(e) = &self.error {
            ui.label(RichText::new(e).small().color(ui.visuals().error_fg_color));
        }
    }

    /// «Documento activo»: subir versión o guardarlo en un proyecto.
    fn active_doc(&mut self, ui: &mut Ui, doc: Option<&Path>) -> Option<IureAct> {
        let c = theme::colors(ui);
        let mut act = None;
        ui.label(RichText::new(pick("ACTIVE DOCUMENT", "DOCUMENTO ACTIVO")).small().color(c.text_muted));
        match doc.and_then(|d| self.mirror_of(d).cloned()) {
            Some(m) => {
                let target = if m.case_id.is_some() {
                    m.case_title.clone()
                } else {
                    format!("General ({} {})", pick("no", "sin"), self.case_label())
                };
                ui.horizontal(|ui| {
                    let side = theme::density(ui.ctx()).icon_size();
                    let (r, _) = ui.allocate_exact_size(vec2(side, side), Sense::hover());
                    icons::paint(ui.painter(), r, Icon::CloudUp, c.text_muted, c.accent);
                    ui.label(RichText::new(target).color(c.text));
                });
                if ui
                    .add_enabled(!self.busy, egui::Button::new(pick("Upload version now", "Subir versión ahora")))
                    .clicked()
                {
                    act = Some(IureAct::SaveAndUpload);
                }
                let mut on = self.autosync();
                if ui
                    .checkbox(&mut on, pick("Upload a version on save (Ctrl+S)", "Subir versión al guardar (Ctrl+S)"))
                    .changed()
                {
                    self.store.autosync = Some(on);
                    self.save_store();
                }
            }
            None => {
                ui.label(
                    RichText::new(pick("Not linked to Iurefficient.", "No vinculado a Iurefficient."))
                        .color(c.text_muted),
                );
                if ui
                    .add_enabled(
                        !self.busy,
                        egui::Button::new(pick("Save to Iurefficient…", "Guardar en Iurefficient…")),
                    )
                    .clicked()
                {
                    self.targets = !self.targets;
                }
                if self.targets {
                    let label = self.case_label();
                    if ui.button(format!("General ({} {label})", pick("no", "sin"))).clicked() {
                        act = Some(IureAct::SaveNew { case_id: None, case_title: String::new() });
                    }
                    match self.case.clone() {
                        Some(k) => {
                            if ui.button(format!("{} · {}", k.case_number, k.title)).clicked() {
                                act = Some(IureAct::SaveNew { case_id: Some(k.id), case_title: k.title });
                            }
                        }
                        None => {
                            ui.label(
                                RichText::new(format!(
                                    "{} {label} {}",
                                    pick("Choose a", "Elige abajo un"),
                                    pick("below to save it there.", "para guardarlo ahí.")
                                ))
                                .small()
                                .color(c.text_muted),
                            );
                        }
                    }
                }
            }
        }
        if let Some((ok, msg)) = &self.notice {
            let ink = if *ok { c.success } else { ui.visuals().error_fg_color };
            ui.label(RichText::new(format!("{} {msg}", if *ok { "✔" } else { "⚠" })).small().color(ink));
        }
        act
    }

    /// Buscar proyectos y abrir sus documentos.
    fn browser(&mut self, ui: &mut Ui) {
        let ctx = ui.ctx().clone();
        let c = theme::colors(ui);
        let now = ctx.input(|i| i.time);
        let label = self.case_label();
        let q = ui.add(
            egui::TextEdit::singleline(&mut self.query)
                .hint_text(format!("{} {label}…", pick("Search", "Buscar")))
                .desired_width(f32::INFINITY),
        );
        if q.changed() {
            self.typed = Some(now);
        }
        if let Some(t) = self.typed
            && now - t >= DEBOUNCE
        {
            self.typed = None;
            let query = self.query.trim().to_string();
            if self.asked.as_deref() != Some(query.as_str()) {
                self.asked = Some(query.clone());
                self.send(Req::Cases(query));
            }
        } else if self.typed.is_some() {
            ctx.request_repaint_after(Duration::from_millis(120));
        }
        if self.busy {
            ui.add(egui::Spinner::new().size(12.0));
        }
        egui::ScrollArea::vertical().id_salt("side-iure").show(ui, |ui| match self.case.clone() {
            None => {
                if self.cases.is_empty() && !self.busy {
                    ui.label(RichText::new(pick("No results", "Sin resultados")).color(c.text_muted));
                }
                for k in self.cases.clone() {
                    let line = format!("{} · {}", k.case_number, k.title);
                    let r = two_line_row(ui, Icon::Folder, &line, k.client_name.as_deref(), true);
                    if r.clicked() {
                        self.docs = None;
                        self.send(Req::Docs(k.id.clone()));
                        self.case = Some(k);
                    }
                }
            }
            Some(k) => {
                if ui.link(format!("← {label}s")).clicked() {
                    self.case = None;
                    self.docs = None;
                    return;
                }
                ui.label(RichText::new(format!("{} · {}", k.case_number, k.title)).strong().color(c.text));
                match &self.docs {
                    None => {
                        ui.label(RichText::new(pick("Loading documents…", "Cargando documentos…")).color(c.text_muted));
                    }
                    Some(d) if d.is_empty() => {
                        ui.label(RichText::new(pick("No documents", "Sin documentos")).color(c.text_muted));
                    }
                    Some(d) => {
                        for doc in d.clone() {
                            let shown = if doc.title.is_empty() { doc.file_name.clone() } else { doc.title.clone() };
                            let r = two_line_row(ui, Icon::Notes, &shown, None, doc.editable);
                            let r = if doc.editable {
                                r
                            } else {
                                r.on_hover_text(format!(
                                    "{} {}",
                                    doc.file_name,
                                    pick("(not text or Markdown)", "(no es texto ni Markdown)")
                                ))
                            };
                            if doc.editable && r.clicked() {
                                self.send(Req::Open {
                                    case_id: Some(k.id.clone()),
                                    case_title: k.title.clone(),
                                    doc_id: doc.id.clone(),
                                    file_name: doc.file_name.clone(),
                                });
                            }
                        }
                    }
                }
            }
        });
    }
}

/// Renglón con icono, texto y, si se da, una segunda línea gris.
fn two_line_row(ui: &mut Ui, icon: Icon, text: &str, sub: Option<&str>, enabled: bool) -> egui::Response {
    let c = theme::colors(ui);
    let w = ui.available_width();
    let h = if sub.is_some() { 40.0 } else { 26.0 };
    let (rect, resp) = ui.allocate_exact_size(vec2(w, h), if enabled { Sense::click() } else { Sense::hover() });
    if enabled && resp.hovered() {
        ui.painter().rect_filled(rect, 4.0, c.hover);
    }
    let ink = if enabled { c.text } else { c.text_muted.gamma_multiply(0.6) };
    let side = 16.0;
    let top = rect.top() + 5.0;
    let ir = egui::Rect::from_min_size(egui::pos2(rect.left() + 6.0, top), vec2(side, side));
    icons::paint(ui.painter(), ir, icon, ink, if enabled { c.accent } else { ink });
    let font = theme::body_font(ui.ctx());
    let g = iurefficient_ui::widgets::text::elided(ui, text, font.clone(), ink, w - 34.0);
    ui.painter().galley(egui::pos2(rect.left() + 28.0, top), g, ink);
    if let Some(s) = sub {
        let small = egui::FontId::new(font.size * 0.85, font.family);
        let g = iurefficient_ui::widgets::text::elided(ui, s, small, c.text_muted, w - 34.0);
        ui.painter().galley(egui::pos2(rect.left() + 28.0, top + 18.0), g, c.text_muted);
    }
    iurefficient_ui::a11y::row(&resp, text, false);
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_paths_are_safe_and_grouped_by_project() {
        let base = Path::new("/datos");
        assert_eq!(
            mirror_path(base, Some("c1"), "d9", "Contrato: v2/final?.md"),
            Path::new("/datos/iurefficient/c1/d9/Contrato_ v2_final_.md")
        );
        assert_eq!(mirror_path(base, None, "../x", "..md"), Path::new("/datos/iurefficient/general/_x/md"));
        assert_eq!(safe_name("   "), "documento.md");
    }

    #[test]
    fn editable_documents_come_first() {
        let d = |t: &str, f: &str| Document {
            id: t.into(),
            title: t.into(),
            file_name: f.into(),
            document_type: String::new(),
            version: None,
            transcription_status: None,
            is_version: false,
        };
        let out = sort_docs(vec![d("b", "b.pdf"), d("Z", "z.md"), d("a", "a.txt"), d("c", "")]);
        let order: Vec<(&str, bool)> = out.iter().map(|x| (x.title.as_str(), x.editable)).collect();
        assert_eq!(order, [("a", true), ("Z", true), ("b", false), ("c", false)]);
    }

    fn ready() -> Rep {
        Rep::Status {
            status: Status::Ready {
                name: "Ana".into(),
                email: "ana@x.com".into(),
                host: "x.com".into(),
                case_label: "caso".into(),
            },
            account: None,
            error: None,
        }
    }

    /// Abrir un documento lo recuerda como espejo; guardar ese archivo sube la versión (si está
    /// activo «subir al guardar»), y otro archivo no sube nada.
    #[test]
    fn opened_documents_upload_a_version_on_save() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, server_rx) = channel();
        let (server_tx, rx) = channel();
        let mut p = IurePanel::with_link(Some(dir.path().to_path_buf()), tx, rx);
        server_tx.send(ready()).unwrap();
        assert_eq!(p.poll(), None);
        let path = mirror_path(dir.path(), Some("c1"), "d1", "nota.md");
        let m = Mirror {
            case_id: Some("c1".into()),
            case_title: "Caso".into(),
            document_id: "d1".into(),
            file_name: "nota.md".into(),
        };
        server_tx.send(Rep::Opened { path: path.clone(), mirror: m.clone() }).unwrap();
        assert_eq!(p.poll(), Some(IureAct::Open(path.clone())));
        // Se recuerda en disco.
        let again = IurePanel::new(Some(dir.path().to_path_buf()));
        assert_eq!(again.mirror_of(&path), Some(&m));
        assert_eq!(again.store.email, "ana@x.com");
        p.after_save(&dir.path().join("otro.md"));
        assert!(server_rx.try_recv().is_err(), "un archivo que no es espejo no sube");
        p.after_save(&path);
        assert_eq!(server_rx.try_recv().ok(), Some(Req::Upload { path: path.clone(), mirror: m }));
        p.store.autosync = Some(false);
        p.after_save(&path);
        assert!(server_rx.try_recv().is_err(), "sin «subir al guardar», no sube");
    }

    fn typ(h: &mut egui_kittest::Harness<'_, IurePanel>, label: &str, text: &str) {
        use egui_kittest::kittest::Queryable;
        h.get_by_label(label).focus();
        h.run();
        h.get_by_label(label).type_text(text);
        h.run();
    }

    /// El formulario: conectar manda dominio, correo y contraseña (y la olvida); con TOTP, el código.
    #[test]
    fn the_login_form_sends_credentials_and_then_the_code() {
        use egui_kittest::kittest::Queryable;
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let (tx, server_rx) = channel();
        let (server_tx, rx) = channel();
        let mut p = IurePanel::with_link(None, tx, rx);
        p.status = Some(Status::LoggedOut);
        let mut h = egui_kittest::Harness::builder().with_size(vec2(300.0, 500.0)).build_ui_state(
            |ui, p: &mut IurePanel| {
                p.poll();
                p.show(ui, None);
            },
            p,
        );
        h.run();
        typ(&mut h, "Dominio (p. ej. 2.ds.iurefficient.com)", "x.com");
        typ(&mut h, "Correo", "ana@x.com");
        typ(&mut h, "Contraseña de Iurefficient", "secreta");
        h.run();
        h.get_by_label("Conectar").click();
        h.run_steps(2);
        assert_eq!(
            server_rx.try_recv().ok(),
            Some(Req::Login { domain: "x.com".into(), email: "ana@x.com".into(), password: "secreta".into() })
        );
        assert!(h.state().password.is_empty(), "la contraseña no se queda en memoria");
        server_tx.send(Rep::Status { status: Status::Totp { token: "t".into() }, account: None, error: None }).unwrap();
        h.run_steps(2);
        typ(&mut h, "Código de verificación (6 dígitos)", "123456");
        h.run_steps(2);
        h.get_by_label("Verificar").click();
        h.run_steps(2);
        assert_eq!(server_rx.try_recv().ok(), Some(Req::Totp { token: "t".into(), code: "123456".into() }));
        server_tx.send(ready()).unwrap();
        h.run_steps(3);
        assert!(h.query_by_label("Ana").is_some());
        assert!(h.query_by_label("No vinculado a Iurefficient.").is_some());
    }
}
