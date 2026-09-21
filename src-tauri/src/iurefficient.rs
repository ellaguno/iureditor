//! Integración con Iurefficient: sesión con la cuenta, abrir documentos Markdown de
//! un proyecto y guardarlos de vuelta como versiones.
//!
//! Los documentos remotos se trabajan como **espejos locales**: al abrirlos se
//! descargan a la carpeta de datos de la app y el editor los trata como archivos
//! normales (deshacer, borradores, imágenes…). Un mapa ruta local → documento
//! remoto permite subir la versión nueva al guardar.

use anyhow::{anyhow, Result};
use iurefficient_connect::rest::{Login, Session, SessionExport};
use iurefficient_connect::{api, secrets, user_agent, Account};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{App, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mirror {
    pub case_id: Option<String>,
    pub case_title: Option<String>,
    pub document_id: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Config {
    domain: String,
    email: String,
    /// Ruta local → documento remoto.
    mirrors: HashMap<String, Mirror>,
}

pub struct IureState {
    config_path: PathBuf,
    mirror_dir: PathBuf,
    config: Mutex<Config>,
    session: tokio::sync::Mutex<Option<Arc<Session>>>,
}

fn agente() -> String {
    user_agent("IureEditor", env!("CARGO_PKG_VERSION"))
}

pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&config_dir)?;
    let config_path = config_dir.join("iurefficient.json");
    let config = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    app.manage(IureState {
        config_path,
        mirror_dir: data_dir.join("iurefficient"),
        config: Mutex::new(config),
        session: tokio::sync::Mutex::new(None),
    });
    Ok(())
}

impl IureState {
    fn save_config(&self) {
        let cfg = self.config.lock().unwrap();
        if let Ok(json) = serde_json::to_string_pretty(&*cfg) {
            let _ = std::fs::write(&self.config_path, json);
        }
    }
    fn account(&self) -> Result<Account> {
        let cfg = self.config.lock().unwrap();
        Account::new(&cfg.domain, &cfg.email)
    }
    async fn session(&self) -> Result<Arc<Session>> {
        if let Some(s) = self.session.lock().await.as_ref() {
            return Ok(s.clone());
        }
        let acc = self.account()?;
        let saved = secrets::leer(&acc, secrets::Kind::Session)
            .ok()
            .flatten()
            .and_then(|j| serde_json::from_str::<SessionExport>(&j).ok())
            .ok_or_else(|| anyhow!("Inicia sesión en Iurefficient"))?;
        let sess = Session::new(acc.clone(), &agente())?;
        sess.import(&saved).await?;
        persist_session(&acc, &sess);
        let sess = Arc::new(sess);
        *self.session.lock().await = Some(sess.clone());
        Ok(sess)
    }
}

fn persist_session(acc: &Account, sess: &Session) {
    if let Ok(json) = serde_json::to_string(&sess.export()) {
        let _ = secrets::guardar(acc, secrets::Kind::Session, &json);
    }
}

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    domain: String,
    email: String,
    logged_in: bool,
    name: Option<String>,
    case_label: String,
    error: Option<String>,
}

#[tauri::command]
pub async fn iure_status(state: State<'_, IureState>) -> Result<Status, String> {
    let (domain, email) = {
        let c = state.config.lock().unwrap();
        (c.domain.clone(), c.email.clone())
    };
    if domain.is_empty() || email.is_empty() {
        return Ok(Status { domain, email, logged_in: false, name: None, case_label: "proyecto".into(), error: None });
    }
    let sess = match state.session().await {
        Ok(s) => s,
        Err(e) => return Ok(Status { domain, email, logged_in: false, name: None, case_label: "proyecto".into(), error: Some(err(e)) }),
    };
    match sess.me().await {
        Ok(u) => {
            let case_label = api::terminology(&sess).await.map(|t| t.case).unwrap_or_else(|_| "proyecto".into());
            let name = u.name.clone().or_else(|| u.extra.get("full_name").and_then(|v| v.as_str()).map(str::to_string));
            Ok(Status { domain, email, logged_in: true, name, case_label, error: None })
        }
        Err(e) => {
            *state.session.lock().await = None;
            Ok(Status { domain, email, logged_in: false, name: None, case_label: "proyecto".into(), error: Some(err(e)) })
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResult {
    logged_in: bool,
    requires_totp: bool,
    totp_token: Option<String>,
    name: Option<String>,
}

#[tauri::command]
pub async fn iure_login(
    state: State<'_, IureState>,
    domain: String,
    email: String,
    password: String,
    totp_token: Option<String>,
    totp_code: Option<String>,
) -> Result<LoginResult, String> {
    let acc = Account::new(&domain, &email).map_err(err)?;
    let sess = Session::new(acc.clone(), &agente()).map_err(err)?;
    let user = match (totp_token, totp_code) {
        (Some(t), Some(c)) if !t.is_empty() => sess.verify_totp(&t, &c).await.map_err(err)?,
        _ => match sess.login(&password).await.map_err(err)? {
            Login::Ok(u) => u,
            Login::TotpRequired { totp_token } => {
                return Ok(LoginResult { logged_in: false, requires_totp: true, totp_token: Some(totp_token), name: None });
            }
        },
    };
    persist_session(&acc, &sess);
    {
        let mut c = state.config.lock().unwrap();
        c.domain = acc.host();
        c.email = acc.email.clone();
    }
    state.save_config();
    *state.session.lock().await = Some(Arc::new(sess));
    let name = user.name.clone().or_else(|| user.extra.get("full_name").and_then(|v| v.as_str()).map(str::to_string));
    Ok(LoginResult { logged_in: true, requires_totp: false, totp_token: None, name })
}

#[tauri::command]
pub async fn iure_logout(state: State<'_, IureState>) -> Result<(), String> {
    if let Some(s) = state.session.lock().await.take() {
        let _ = s.logout().await;
    }
    if let Ok(acc) = state.account() {
        let _ = secrets::borrar(&acc, secrets::Kind::Session);
    }
    Ok(())
}

#[tauri::command]
pub async fn iure_cases(state: State<'_, IureState>, query: String) -> Result<Vec<api::CaseSummary>, String> {
    let sess = state.session().await.map_err(err)?;
    api::cases(&sess, Some(&query), 50).await.map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDoc {
    id: String,
    title: String,
    file_name: String,
    editable: bool,
}

fn is_text(name: &str) -> bool {
    matches!(
        Path::new(name).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(),
        Some("md") | Some("markdown") | Some("txt")
    )
}

#[tauri::command]
pub async fn iure_case_documents(state: State<'_, IureState>, case_id: String) -> Result<Vec<RemoteDoc>, String> {
    let sess = state.session().await.map_err(err)?;
    let docs = api::documents_of_case(&sess, &case_id).await.map_err(err)?;
    let mut out: Vec<RemoteDoc> = docs
        .into_iter()
        .map(|d| RemoteDoc { editable: is_text(&d.file_name), id: d.id, title: d.title, file_name: d.file_name })
        .collect();
    out.sort_by(|a, b| b.editable.cmp(&a.editable).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(out)
}

fn safe_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c }).collect();
    if s.trim().is_empty() { "documento.md".into() } else { s }
}

/// Descarga el documento a su espejo local y lo registra. Devuelve la ruta local.
#[tauri::command]
pub async fn iure_open_document(
    state: State<'_, IureState>,
    case_id: Option<String>,
    case_title: Option<String>,
    document_id: String,
    file_name: String,
) -> Result<String, String> {
    let sess = state.session().await.map_err(err)?;
    let dir = state.mirror_dir.join(case_id.as_deref().unwrap_or("general")).join(&document_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let local = dir.join(safe_name(&file_name));
    api::download_document(&sess, &document_id, &local).await.map_err(err)?;
    let key = local.to_string_lossy().into_owned();
    {
        let mut c = state.config.lock().unwrap();
        c.mirrors.insert(key.clone(), Mirror { case_id, case_title, document_id, file_name });
    }
    state.save_config();
    Ok(key)
}

#[tauri::command]
pub fn iure_mirror_of(state: State<'_, IureState>, path: String) -> Option<Mirror> {
    state.config.lock().unwrap().mirrors.get(&path).cloned()
}

/// Sube el archivo local como versión nueva de su documento remoto.
#[tauri::command]
pub async fn iure_upload_version(state: State<'_, IureState>, path: String) -> Result<Mirror, String> {
    let mirror = state.config.lock().unwrap().mirrors.get(&path).cloned().ok_or("Este archivo no está vinculado a un documento de Iurefficient")?;
    let sess = state.session().await.map_err(err)?;
    let opts = api::UploadOptions { as_version_of: Some(mirror.document_id.clone()), file_name: Some(mirror.file_name.clone()), ..Default::default() };
    let doc = api::upload_document(&sess, Path::new(&path), &opts).await.map_err(err)?;
    // La versión nueva puede tener id propio: el espejo apunta siempre al documento raíz.
    let _ = doc;
    Ok(mirror)
}

/// Sube un archivo local como documento nuevo del proyecto y lo vincula.
#[tauri::command]
pub async fn iure_save_new(state: State<'_, IureState>, path: String, case_id: Option<String>, case_title: Option<String>) -> Result<Mirror, String> {
    let sess = state.session().await.map_err(err)?;
    let p = PathBuf::from(&path);
    let file_name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "documento.md".into());
    let opts = api::UploadOptions { case_id: case_id.clone(), file_name: Some(file_name.clone()), tags: vec!["iureditor".into()], ..Default::default() };
    let doc = api::upload_document(&sess, &p, &opts).await.map_err(err)?;
    let mirror = Mirror { case_id, case_title, document_id: doc.id, file_name };
    {
        let mut c = state.config.lock().unwrap();
        c.mirrors.insert(path, mirror.clone());
    }
    state.save_config();
    Ok(mirror)
}
