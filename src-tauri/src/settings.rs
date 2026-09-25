//! Ajustes generales de la app guardados por el backend en
//! `<config>/settings.json`. Por ahora sólo el idioma de la interfaz; las
//! preferencias de vista (tema, zoom…) siguen en el localStorage del webview.

use iurefficient_connect::lang;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{App, AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// `"auto"` (idioma del sistema), `"en"` o `"es"`.
    pub ui_language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { ui_language: "auto".into() }
    }
}

pub struct SettingsState {
    path: PathBuf,
    settings: Mutex<Settings>,
}

/// Normaliza la preferencia de idioma: cualquier valor desconocido es "auto".
fn normalize_language(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "en" => "en".into(),
        "es" => "es".into(),
        _ => "auto".into(),
    }
}

fn load(path: &PathBuf) -> Settings {
    let mut s: Settings = std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    s.ui_language = normalize_language(&s.ui_language);
    s
}

/// Carga los ajustes y fija el idioma de los mensajes del backend. Debe
/// llamarse al principio del `setup`, antes de cualquier mensaje al usuario.
pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let config_dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&config_dir)?;
    let path = config_dir.join("settings.json");
    let settings = load(&path);
    lang::set(lang::resolve(&settings.ui_language));
    app.manage(SettingsState { path, settings: Mutex::new(settings) });
    Ok(())
}

/// Idioma resuelto de la interfaz (`"en"` / `"es"`): la preferencia guardada
/// o, en automático, el del sistema operativo.
#[tauri::command]
pub fn ui_language() -> String {
    lang::current().code().to_string()
}

/// Preferencia guardada tal cual (`"auto"`, `"en"` o `"es"`).
#[tauri::command]
pub fn get_ui_language_pref(state: State<'_, SettingsState>) -> String {
    state.settings.lock().unwrap().ui_language.clone()
}

/// Guarda la preferencia de idioma, la aplica y avisa a todas las ventanas.
/// Devuelve el idioma resuelto.
#[tauri::command]
pub fn set_ui_language(app: AppHandle, state: State<'_, SettingsState>, value: String) -> Result<String, String> {
    let pref = normalize_language(&value);
    let json = {
        let mut s = state.settings.lock().unwrap();
        s.ui_language = pref.clone();
        serde_json::to_string_pretty(&*s).map_err(|e| e.to_string())?
    };
    lang::set(lang::resolve(&pref));
    let code = lang::current().code().to_string();
    let _ = app.emit("ui-language-changed", code.clone());
    std::fs::write(&state.path, json).map_err(|e| {
        iurefficient_connect::tr!("Could not save the settings: {e}", "No se pudieron guardar los ajustes: {e}")
    })?;
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ajustes_antiguos_sin_idioma_cargan_en_auto() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.ui_language, "auto");
        let s: Settings = serde_json::from_str(r#"{"uiLanguage":"es"}"#).unwrap();
        assert_eq!(s.ui_language, "es");
    }

    #[test]
    fn normaliza_preferencia() {
        assert_eq!(normalize_language("EN"), "en");
        assert_eq!(normalize_language("es"), "es");
        assert_eq!(normalize_language("fr"), "auto");
        assert_eq!(normalize_language(""), "auto");
    }
}
