//! La ventana: barra con las acciones del archivo, pestañas y el editor de documentos de la suite.
//!
//! Cada documento abierto es una pestaña con su propio editor (cursor y deshacer), su borrador de
//! recuperación y su vigilancia de cambios en disco. Ctrl+T / Ctrl+N abren una pestaña, Ctrl+W la
//! cierra (pregunta si hay cambios), Ctrl+Tab / Ctrl+Mayús+Tab (o Ctrl+AvPág / Ctrl+RePág) pasan
//! de una a otra. Al cerrar la ventana se recorren las pestañas con cambios y se guarda la sesión,
//! que se restaura al abrir sin archivo (como la versión Tauri).

use std::path::PathBuf;
use std::sync::mpsc;

use egui::{Key, KeyboardShortcut, Modifiers};
use iurefficient_ui::Icon;
use iurefficient_ui::lang::pick;

use crate::doc::Doc;

/// Qué se hará cuando se resuelva «¿guardar los cambios?».
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Then {
    /// Cerrar la pestaña activa.
    CloseTab,
    /// Cerrar la ventana (pestaña por pestaña).
    Close,
}

/// Respuesta de un diálogo de archivo (corre en otro hilo: la ventana no se congela).
enum Picked {
    Open(Option<PathBuf>),
    /// Guardar como: la pestaña (por su identidad) y qué hacer después.
    SaveAs(Option<PathBuf>, u64, Option<Then>),
    /// Exportar: destino, formato y pestaña.
    Export(Option<PathBuf>, crate::export::Format, u64),
}

/// Una pestaña: su documento y lo que se lleva de él.
pub(crate) struct Tab {
    pub(crate) doc: Doc,
    /// Identidad: el estado del editor (cursor, deshacer) y el borrador son por pestaña.
    id: u64,
    /// Huella del texto y cuándo cambió por última vez (segundos de egui).
    seen: (u64, f64),
    /// Huella del último borrador escrito (0: ninguno).
    drafted: u64,
    /// Generación de borradores: un borrador que tarda no reaparece tras guardar o descartar.
    draft_gen: std::sync::Arc<std::sync::Mutex<u64>>,
}

impl Tab {
    fn new(doc: Doc, id: u64) -> Tab {
        Tab { doc, id, seen: (0, 0.0), drafted: 0, draft_gen: std::sync::Arc::new(std::sync::Mutex::new(0)) }
    }

    /// Nombre para la pestaña («• » con cambios sin guardar).
    fn label(&self) -> String {
        let name = self
            .doc
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| pick("Untitled", "Sin título").to_string(), |n| n.to_string_lossy().into_owned());
        if self.doc.dirty() { format!("• {name}") } else { name }
    }

    /// Una pestaña nueva, sin archivo, vacía y sin cambios.
    fn pristine(&self) -> bool {
        self.doc.path.is_none() && self.doc.text.is_empty() && !self.doc.dirty()
    }
}

pub struct EditorApp {
    pub(crate) tabs: Vec<Tab>,
    pub(crate) active: usize,
    next_id: u64,
    notice: Option<String>,
    /// Aviso de que algo salió bien (exportado…).
    info: Option<String>,
    picker: Option<mpsc::Receiver<Picked>>,
    /// Panel lateral: Archivos, Buscar, Esquema.
    pub(crate) side: crate::sidebar::Sidebar,
    /// Sin la barra del sistema: estilo y orden de los botones de la ventana.
    pub(crate) chrome: Option<iurefficient_ui::window::WindowChrome>,
    /// Exportación en curso (dibuja diagramas en otro hilo): el archivo o el error.
    exporting: Option<mpsc::Receiver<Result<PathBuf, String>>>,
    /// Argumentos que manda un segundo `iureditor2` (rutas y enlaces `iureditor://`).
    incoming: Option<mpsc::Receiver<Vec<String>>>,
    /// La escucha de esas instancias (se detiene al cerrar).
    _listener: Option<crate::instance::Listener>,
    /// Enlaces de la línea de órdenes que se aplican en el primer cuadro (`insert`, `edit`).
    pub(crate) pending: Vec<String>,
    /// «¿Guardar los cambios?» pendiente (sobre la pestaña activa).
    ask: Option<Then>,
    /// Cerrar sin volver a preguntar.
    closing: bool,
    /// Última vez que se miró si otro programa cambió los archivos.
    disk_check: f64,
    title: String,
    themed: bool,
    /// Corrector ortográfico (diccionarios del sistema, español e inglés; uno para la app).
    speller: std::sync::Arc<iure_doc_ui::Speller>,
    /// Borradores de recuperación (carpeta; `None`: sin carpeta de datos).
    drafts: Option<PathBuf>,
    /// Archivo de la sesión (`None` en las pruebas).
    session: Option<PathBuf>,
    /// Borradores de un cierre inesperado, para ofrecer recuperarlos (el más reciente primero).
    pub(crate) recovery: Vec<(PathBuf, crate::drafts::Draft)>,
    /// Las notas de la carpeta del documento (para `[[`).
    notes: Option<std::sync::Arc<crate::notes::FolderNotes>>,
    /// Enlace pulsado con Ctrl+clic en este cuadro.
    clicked_link: Option<String>,
    /// Tema elegido en Ver (el del sistema por omisión).
    pub(crate) theme: iurefficient_ui::theme::ThemeMode,
    /// Fuente, tamaño del texto, nitidez y densidad (Ver › Apariencia).
    pub(crate) look: crate::drafts::Appearance,
    /// Zoom del documento (1.0 = 100 %), el mismo para todas las pestañas.
    pub(crate) zoom: f32,
    /// Preferencias guardadas (el zoom; `None` en las pruebas).
    prefs: Option<PathBuf>,
    /// Ver › Ancho de página.
    pub(crate) page: crate::drafts::PageWidth,
    /// Ver › Corrector ortográfico.
    pub(crate) spell_on: bool,
    /// Ver › Código fuente (el Markdown tal cual) y sus números de línea.
    pub(crate) source: bool,
    pub(crate) line_numbers: bool,
    /// Ver › Idioma.
    pub(crate) lang: crate::drafts::LangPref,
    /// Archivo › Recientes (el más reciente primero).
    pub(crate) recent: Vec<PathBuf>,
    /// Edición › Ir a línea: lo escrito en el cuadro abierto.
    goto_line: Option<String>,
    /// Paleta de comandos o «Ir a nota» abierta.
    palette: Option<crate::palette::Palette>,
    /// La carpeta de plantillas (`None` en las pruebas, que ponen la suya).
    pub(crate) templates: Option<PathBuf>,
    /// Nueva desde plantilla: la plantilla y sus campos (nombre, valor) que se están pidiendo.
    template_ask: Option<(String, Vec<(String, String)>)>,
    /// Ayuda › Acerca de.
    about: bool,
    /// Ayuda › Buscar actualizaciones: la búsqueda en curso y su resultado.
    updating: Option<mpsc::Receiver<crate::updates::Check>>,
    update: Option<crate::updates::Check>,
}

/// Espera tras el último cambio antes de escribir el borrador (como IureEditor Tauri).
const DRAFT_DELAY: f64 = 2.5;
/// La letra del documento respecto a la de la interfaz (≈16 px con la densidad normal, como la 1.x).
const DOC_SCALE: f32 = 1.15;
/// Pestañas abiertas como mucho.
const MAX_TABS: usize = 64;

fn hash_text(t: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    t.hash(&mut h);
    h.finish() | 1
}

const SAVE: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::S);
const SAVE_AS: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::S);
const OPEN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::O);
const NEW: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::N);
const NEW_TAB: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::T);
const CLOSE_TAB: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::W);
const QUIT: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Q);
pub(crate) const ZOOM_IN: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Plus);
const ZOOM_IN_EQ: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Equals);
const ZOOM_IN_SHIFT: KeyboardShortcut =
    KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::Equals);
pub(crate) const ZOOM_OUT: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Minus);
pub(crate) const ZOOM_RESET: KeyboardShortcut = KeyboardShortcut::new(Modifiers::COMMAND, Key::Num0);
const FIND_ALL: KeyboardShortcut = KeyboardShortcut::new(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::F);

impl EditorApp {
    #[cfg(test)]
    pub fn new(doc: Doc, notice: Option<String>) -> Self {
        Self::with_docs(vec![doc], 0, notice)
    }

    /// Con varios documentos abiertos (uno por pestaña) y el activo.
    pub fn with_docs(docs: Vec<Doc>, active: usize, notice: Option<String>) -> Self {
        let mut tabs: Vec<Tab> =
            docs.into_iter().take(MAX_TABS).enumerate().map(|(i, d)| Tab::new(d, i as u64 + 1)).collect();
        if tabs.is_empty() {
            tabs.push(Tab::new(Doc::default(), 1));
        }
        let next_id = tabs.len() as u64 + 1;
        let active = active.min(tabs.len().saturating_sub(1));
        EditorApp {
            tabs,
            active,
            next_id,
            notice,
            info: None,
            picker: None,
            exporting: None,
            chrome: None,
            side: {
                let mut side = crate::sidebar::Sidebar::new_open();
                // En las pruebas no se toca la cuenta ni los espejos del usuario.
                if !cfg!(test) {
                    side.iure = crate::iure::IurePanel::new(crate::drafts::data_dir());
                }
                side
            },
            incoming: None,
            _listener: None,
            pending: Vec::new(),
            ask: None,
            closing: false,
            disk_check: 0.0,
            title: String::new(),
            themed: false,
            speller: iure_doc_ui::Speller::system(iure_doc_ui::spell::personal_path("iureditor")),
            // En las pruebas no se tocan los borradores ni la sesión del usuario.
            drafts: if cfg!(test) { None } else { crate::drafts::drafts_dir() },
            session: if cfg!(test) { None } else { crate::drafts::session_file() },
            recovery: Vec::new(),
            zoom: 1.0,
            theme: iurefficient_ui::theme::ThemeMode::System,
            look: crate::drafts::Appearance::default(),
            prefs: None,
            notes: None,
            clicked_link: None,
            page: crate::drafts::PageWidth::default(),
            spell_on: true,
            source: false,
            line_numbers: false,
            lang: crate::drafts::LangPref::default(),
            recent: Vec::new(),
            goto_line: None,
            palette: None,
            template_ask: None,
            templates: if cfg!(test) { None } else { crate::templates::dir() },
            about: false,
            updating: None,
            update: None,
        }
    }

    /// Lee y guarda las preferencias (el zoom) en este archivo.
    pub(crate) fn with_prefs(mut self, f: PathBuf) -> Self {
        self.zoom = crate::drafts::load_zoom(&f);
        self.theme = crate::drafts::load_theme(&f);
        self.look = crate::drafts::load_appearance(&f);
        let key = |k: &str| crate::drafts::load_pref(&f, k);
        self.page =
            key("page_width").and_then(|v| v.as_str().map(crate::drafts::PageWidth::from_key)).unwrap_or_default();
        self.spell_on = key("spellcheck").and_then(|v| v.as_bool()).unwrap_or(true);
        self.line_numbers = key("line_numbers").and_then(|v| v.as_bool()).unwrap_or(false);
        self.lang = key("language").and_then(|v| v.as_str().map(crate::drafts::LangPref::from_key)).unwrap_or_default();
        iurefficient_ui::lang::set_lang(self.lang.lang());
        self.recent = crate::drafts::load_recent(&f);
        self.prefs = Some(f);
        self
    }

    /// Guarda una preferencia (si hay archivo de preferencias).
    fn save_pref(&self, key: &str, v: serde_json::Value) {
        if let Some(f) = &self.prefs {
            crate::drafts::save_pref(f, key, v);
        }
    }

    /// Anota un archivo en Recientes.
    fn remember(&mut self, path: &std::path::Path) {
        if let Some(f) = self.prefs.clone() {
            crate::drafts::push_recent(&f, &mut self.recent, path);
        } else {
            self.recent.retain(|p| p != path);
            self.recent.insert(0, path.to_path_buf());
            self.recent.truncate(crate::drafts::MAX_RECENT);
        }
    }

    /// Los nombres de las plantillas (crea la carpeta con las de arranque si no existe).
    pub(crate) fn template_names(&self) -> Vec<String> {
        self.templates
            .as_deref()
            .map(|d| {
                crate::templates::ensure(d);
                crate::templates::list(d)
            })
            .unwrap_or_default()
    }

    /// El id del editor de la pestaña activa.
    fn editor_id(&self) -> Option<egui::Id> {
        self.tabs.get(self.active).map(|t| egui::Id::unique(("iureditor-doc", t.id)))
    }

    /// Cambia el zoom del documento (acotado) y lo guarda.
    pub(crate) fn set_zoom(&mut self, z: f32) {
        let z = if z.is_finite() { z.clamp(iure_doc_ui::ZOOM_MIN, iure_doc_ui::ZOOM_MAX) } else { 1.0 };
        if (z - self.zoom).abs() < 0.001 {
            return;
        }
        self.zoom = z;
        if let Some(f) = &self.prefs {
            crate::drafts::save_zoom(f, z);
        }
    }

    /// Ctrl + / Ctrl − / Ctrl 0 y Ctrl con la rueda (o el pellizco).
    fn zoom_keys(&mut self, ctx: &egui::Context) {
        let (up, down, reset, delta) = ctx.input_mut(|i| {
            let up =
                i.consume_shortcut(&ZOOM_IN) || i.consume_shortcut(&ZOOM_IN_EQ) || i.consume_shortcut(&ZOOM_IN_SHIFT);
            let down = i.consume_shortcut(&ZOOM_OUT);
            let reset = i.consume_shortcut(&ZOOM_RESET);
            (up, down, reset, i.zoom_delta())
        });
        if reset {
            self.set_zoom(1.0);
        } else if up {
            self.set_zoom(iure_doc_ui::zoom_step(self.zoom, true));
        } else if down {
            self.set_zoom(iure_doc_ui::zoom_step(self.zoom, false));
        } else if (delta - 1.0).abs() > 0.001 {
            self.set_zoom(self.zoom * delta);
        }
    }

    /// El documento de la pestaña activa.
    pub(crate) fn doc(&self) -> &Doc {
        // Siempre hay al menos una pestaña; por si acaso, un documento vacío.
        static EMPTY: std::sync::OnceLock<Doc> = std::sync::OnceLock::new();
        self.tabs.get(self.active).or(self.tabs.first()).map_or_else(|| EMPTY.get_or_init(Doc::default), |t| &t.doc)
    }

    fn tab_mut(&mut self) -> Option<&mut Tab> {
        let i = self.active;
        self.tabs.get_mut(i)
    }

    fn new_id(&mut self) -> u64 {
        self.next_id = self.next_id.wrapping_add(1);
        self.next_id
    }

    /// Abre `doc` en una pestaña nueva (o en la activa si es nueva y está vacía).
    fn push_tab(&mut self, doc: Doc) {
        let id = self.new_id();
        if self.tabs.get(self.active).is_some_and(Tab::pristine) {
            if let Some(t) = self.tab_mut() {
                *t = Tab::new(doc, id);
            }
            return;
        }
        if self.tabs.len() >= MAX_TABS {
            self.notice = Some(pick("Too many open tabs.", "Hay demasiadas pestañas abiertas.").to_string());
            return;
        }
        self.tabs.push(Tab::new(doc, id));
        self.active = self.tabs.len() - 1;
    }

    /// Abre un archivo: si ya está abierto, pasa a su pestaña.
    fn open_path(&mut self, path: &std::path::Path) {
        let canon = path.canonicalize().ok();
        if let Some(i) = self.tabs.iter().position(|t| {
            t.doc.path.as_ref().is_some_and(|p| p == path || (canon.is_some() && p.canonicalize().ok() == canon))
        }) {
            self.active = i;
            return;
        }
        match Doc::open(path) {
            Ok(d) => {
                self.push_tab(d);
                self.remember(path);
            }
            Err(e) => self.notice = Some(e.human(path)),
        }
    }

    fn open_dialog(&mut self) {
        let (tx, rx) = mpsc::channel();
        let dir = self.doc().path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        std::thread::spawn(move || {
            let mut d = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown", "txt"]);
            if let Some(dir) = dir {
                d = d.set_directory(dir);
            }
            let _ = tx.send(Picked::Open(d.pick_file()));
        });
        self.picker = Some(rx);
    }

    fn save_as_dialog(&mut self, then: Option<Then>) {
        let (tx, rx) = mpsc::channel();
        let name = self
            .doc()
            .path
            .as_ref()
            .and_then(|p| p.file_name())
            .map_or_else(|| format!("{}.md", pick("document", "documento")), |n| n.to_string_lossy().into_owned());
        let id = self.tabs.get(self.active).map_or(0, |t| t.id);
        std::thread::spawn(move || {
            let d = rfd::FileDialog::new().add_filter("Markdown", &["md", "markdown", "txt"]).set_file_name(name);
            let _ = tx.send(Picked::SaveAs(d.save_file(), id, then));
        });
        self.picker = Some(rx);
    }

    /// Recibe los argumentos de un segundo `iureditor2`.
    pub(crate) fn set_incoming(&mut self, rx: mpsc::Receiver<Vec<String>>, listener: crate::instance::Listener) {
        self.incoming = Some(rx);
        self._listener = Some(listener);
    }

    /// Rutas y enlaces `iureditor://` (de la línea de órdenes o de otra instancia). Abrir trae la
    /// ventana al frente; escribir por voz (`insert`, `edit`) no le quita el foco a nadie.
    pub(crate) fn handle_args(&mut self, ctx: &egui::Context, args: Vec<String>) {
        let mut focus = args.is_empty();
        for arg in args.iter().take(64) {
            match crate::links::parse(arg) {
                Some(crate::links::Link::Open(p)) => {
                    focus = true;
                    if p.exists() {
                        self.open_path(&p);
                    } else {
                        // Un archivo nuevo: se crea al guardar.
                        self.push_tab(Doc { path: Some(p), ..Default::default() });
                    }
                }
                Some(crate::links::Link::Insert { text, path }) => {
                    self.external(ctx, path.as_deref(), iure_doc_ui::ExternalEdit::Insert(text));
                }
                Some(crate::links::Link::Edit { action, path }) => self.external(ctx, path.as_deref(), action),
                None => {
                    self.notice = Some(format!(
                        "{} «{arg}».",
                        pick("This link is not understood:", "No se entiende este enlace:")
                    ));
                }
            }
        }
        if focus {
            ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
        }
    }

    /// Una edición desde fuera en el documento de `path` (lo abre si hace falta) o en el activo.
    fn external(&mut self, ctx: &egui::Context, path: Option<&std::path::Path>, edit: iure_doc_ui::ExternalEdit) {
        if let Some(p) = path {
            if !p.is_file() {
                self.notice = Some(format!(
                    "{} «{}».",
                    pick("The document does not exist:", "No existe el documento:"),
                    p.display()
                ));
                return;
            }
            self.open_path(p);
        }
        let Some(t) = self.tabs.get_mut(self.active) else { return };
        iure_doc_ui::apply_external(ctx, egui::Id::unique(("iureditor-doc", t.id)), &mut t.doc.text, edit);
    }

    fn poll_incoming(&mut self, ctx: &egui::Context) {
        if !self.pending.is_empty() {
            let p = std::mem::take(&mut self.pending);
            self.handle_args(ctx, p);
        }
        let mut got = Vec::new();
        if let Some(rx) = &self.incoming {
            while let Ok(a) = rx.try_recv() {
                got.push(a);
            }
        }
        for a in got.into_iter().take(16) {
            self.handle_args(ctx, a);
        }
    }

    fn export_dialog(&mut self, format: crate::export::Format) {
        let (tx, rx) = mpsc::channel();
        let path = self.doc().path.clone();
        let stem = path
            .as_ref()
            .and_then(|p| p.file_stem())
            .map_or_else(|| pick("document", "documento").to_string(), |n| n.to_string_lossy().into_owned());
        let dir = path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        let id = self.tabs.get(self.active).map_or(0, |t| t.id);
        std::thread::spawn(move || {
            let mut d = rfd::FileDialog::new()
                .add_filter(format.filter(), &[format.ext()])
                .set_file_name(format!("{stem}.{}", format.ext()));
            if let Some(dir) = dir {
                d = d.set_directory(dir);
            }
            let _ = tx.send(Picked::Export(d.save_file(), format, id));
        });
        self.picker = Some(rx);
    }

    /// Exporta la pestaña `id` a `out` en otro hilo (los diagramas tardan en dibujarse).
    fn start_export(&mut self, ctx: &egui::Context, out: PathBuf, format: crate::export::Format, id: u64) {
        let Some(t) = self.tabs.iter().find(|t| t.id == id) else { return };
        let text = t.doc.text.clone();
        let base = t.doc.path.as_ref().and_then(|p| p.parent().map(PathBuf::from));
        let (tx, rx) = mpsc::channel();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let r = crate::export::export(&text, base, format, &out).map(|()| out);
            let _ = tx.send(r);
            ctx.request_repaint();
        });
        self.info = Some(pick("Exporting…", "Exportando…").to_string());
        self.exporting = Some(rx);
    }

    fn poll_export(&mut self) {
        let Some(rx) = &self.exporting else { return };
        let r = match rx.try_recv() {
            Ok(r) => r,
            Err(mpsc::TryRecvError::Empty) => return,
            Err(mpsc::TryRecvError::Disconnected) => {
                Err(pick("The export was interrupted.", "La exportación se interrumpió.").to_string())
            }
        };
        self.exporting = None;
        match r {
            Ok(p) => {
                let name = p.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
                self.info = Some(format!("{} «{name}».", pick("Exported to", "Exportado a")));
            }
            Err(e) => {
                self.info = None;
                self.notice = Some(e);
            }
        }
    }

    /// Guarda la pestaña activa; sin archivo, pregunta dónde. `true` si quedó guardado.
    fn save(&mut self, then: Option<Then>) -> bool {
        if self.doc().path.is_none() {
            self.save_as_dialog(then);
            return false;
        }
        let Some(t) = self.tab_mut() else { return false };
        match t.doc.save(None) {
            Ok(()) => {
                self.after_save();
                true
            }
            Err(e) => {
                let p = t.doc.path.clone().unwrap_or_default();
                self.notice = Some(e.human(&p));
                false
            }
        }
    }

    /// Tras guardar la pestaña activa: si es un documento de Iurefficient, sube la versión.
    fn after_save(&mut self) {
        if let Some(p) = self.doc().path.clone() {
            self.side.iure.after_save(&p);
            self.remember(&p);
        }
    }

    fn act(&mut self, ctx: &egui::Context, then: Then) {
        if then == Then::CloseTab && self.doc().dirty() {
            self.ask = Some(then);
            return;
        }
        self.run(ctx, then);
    }

    fn run(&mut self, ctx: &egui::Context, then: Then) {
        match then {
            Then::CloseTab => {
                let i = self.active;
                self.clear_draft(i);
                if i < self.tabs.len() {
                    self.tabs.remove(i);
                }
                if self.tabs.is_empty() {
                    let id = self.new_id();
                    self.tabs.push(Tab::new(Doc::default(), id));
                }
                self.active = i.min(self.tabs.len().saturating_sub(1));
            }
            Then::Close => {
                // Pestaña por pestaña: la siguiente con cambios pregunta.
                if let Some(i) = self.tabs.iter().position(|t| t.doc.dirty()) {
                    self.active = i;
                    self.ask = Some(Then::Close);
                    return;
                }
                self.closing = true;
                if let Some(f) = &self.session {
                    let paths: Vec<PathBuf> = self.tabs.iter().filter_map(|t| t.doc.path.clone()).collect();
                    let active = self.tabs.iter().take(self.active).filter(|t| t.doc.path.is_some()).count();
                    crate::drafts::save_session(f, &paths, active);
                }
                for i in 0..self.tabs.len() {
                    self.clear_draft(i);
                }
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
    }

    /// Usa otra carpeta de borradores (pruebas).
    #[cfg(test)]
    pub(crate) fn set_drafts_dir(&mut self, dir: PathBuf) {
        self.drafts = Some(dir);
    }

    /// Usa otro archivo de sesión (pruebas).
    #[cfg(test)]
    pub(crate) fn set_session_file(&mut self, f: PathBuf) {
        self.session = Some(f);
    }

    /// Borra el borrador de la pestaña `i` (y anula uno que se esté escribiendo).
    fn clear_draft(&mut self, i: usize) {
        let Some(dir) = self.drafts.clone() else { return };
        let Some(t) = self.tabs.get_mut(i) else { return };
        let mut g = t.draft_gen.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        *g = g.wrapping_add(1);
        crate::drafts::clear(&dir, t.id);
        drop(g);
        t.drafted = 0;
    }

    /// En cada pestaña con cambios sin guardar escribe su borrador 2,5 s después del último
    /// cambio (en otro hilo); sin cambios, lo borra.
    fn draft_tick(&mut self, ctx: &egui::Context) {
        let Some(dir) = self.drafts.clone() else { return };
        let now = ctx.input(|i| i.time);
        for i in 0..self.tabs.len() {
            let Some(t) = self.tabs.get_mut(i) else { continue };
            let h = hash_text(&t.doc.text);
            if h != t.seen.0 {
                t.seen = (h, now);
            }
            if !t.doc.dirty() {
                if t.drafted != 0 {
                    self.clear_draft(i);
                }
                continue;
            }
            if t.drafted == h {
                continue;
            }
            let wait = DRAFT_DELAY - (now - t.seen.1);
            if wait > 0.0 {
                ctx.request_repaint_after(std::time::Duration::from_secs_f64(wait));
                continue;
            }
            t.drafted = h;
            let gen_lock = std::sync::Arc::clone(&t.draft_gen);
            let my_gen = *gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
            let (dir, tab, path, text) = (dir.clone(), t.id, t.doc.path.clone(), t.doc.text.clone());
            std::thread::spawn(move || {
                let g = gen_lock.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                if *g == my_gen {
                    let _ = crate::drafts::write(&dir, tab, path.as_deref(), &text);
                }
            });
        }
    }

    /// «¿Recuperar lo que no se guardó?» tras un cierre inesperado: cada borrador en su pestaña.
    fn recovery_window(&mut self, ctx: &egui::Context) {
        let Some((_, newest)) = self.recovery.first().cloned() else { return };
        let name_of = |d: &crate::drafts::Draft| {
            d.path
                .as_ref()
                .and_then(|p| p.file_name())
                .map_or_else(|| pick("Untitled", "Sin título").to_string(), |n| n.to_string_lossy().into_owned())
        };
        let names: Vec<String> = self.recovery.iter().take(6).map(|(_, d)| format!("«{}»", name_of(d))).collect();
        let more = self.recovery.len().saturating_sub(6);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let mins = now.saturating_sub(newest.saved_at) / 60;
        let when = match mins {
            0 => pick("less than a minute ago", "hace menos de un minuto").to_string(),
            m if m < 120 => format!("{} {m} min", pick("about", "hace")),
            m => format!("{} {} h", pick("about", "hace"), m / 60),
        };
        let mut answer: Option<bool> = None;
        egui::Window::new(pick("Recover unsaved changes?", "¿Recuperar lo que no se guardó?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(format!(
                    "{} {} ({when}).",
                    pick(
                        "IureEditor closed unexpectedly with unsaved changes in",
                        "IureEditor se cerró sin guardar los cambios de"
                    ),
                    names.join(", ")
                ));
                if more > 0 {
                    ui.weak(format!("{} {more}", pick("and more:", "y otros:")));
                }
                ui.horizontal(|ui| {
                    if ui.button(pick("Recover", "Recuperar")).clicked() {
                        answer = Some(true);
                    }
                    if ui.button(pick("Discard", "Descartar")).clicked() {
                        answer = Some(false);
                    }
                });
            });
        match answer {
            Some(true) => {
                // Cada documento con el texto del borrador encima (queda con cambios sin guardar).
                let drafts = std::mem::take(&mut self.recovery);
                for (file, draft) in drafts.into_iter().rev() {
                    let mut doc = match &draft.path {
                        Some(p) if p.is_file() => {
                            Doc::open(p).unwrap_or_else(|_| Doc { path: Some(p.clone()), ..Default::default() })
                        }
                        Some(p) => Doc { path: Some(p.clone()), ..Default::default() },
                        None => Doc::default(),
                    };
                    doc.text = draft.text;
                    // Si ese documento ya está abierto (sin cambios), el borrador va en su pestaña.
                    match self
                        .tabs
                        .iter()
                        .position(|t| t.doc.path.is_some() && t.doc.path == doc.path && !t.doc.dirty())
                    {
                        Some(i) => {
                            if let Some(t) = self.tabs.get_mut(i) {
                                t.doc.text = doc.text;
                            }
                            self.active = i;
                        }
                        None => self.push_tab(doc),
                    }
                    crate::drafts::remove(&[file]);
                }
            }
            Some(false) => {
                let files: Vec<PathBuf> = self.recovery.drain(..).map(|(f, _)| f).collect();
                crate::drafts::remove(&files);
            }
            None => {}
        }
    }

    fn poll_picker(&mut self, ctx: &egui::Context) {
        let Some(rx) = &self.picker else { return };
        let Ok(p) = rx.try_recv() else {
            ctx.request_repaint_after(std::time::Duration::from_millis(200));
            return;
        };
        self.picker = None;
        match p {
            Picked::Open(Some(path)) => self.open_path(&path),
            Picked::SaveAs(Some(path), id, then) => {
                let Some(i) = self.tabs.iter().position(|t| t.id == id) else { return };
                let Some(t) = self.tabs.get_mut(i) else { return };
                match t.doc.save(Some(&path)) {
                    Ok(()) => {
                        if self.active == i {
                            self.after_save();
                        }
                        if let Some(then) = then {
                            self.active = i;
                            self.run(ctx, then);
                        }
                    }
                    Err(e) => self.notice = Some(e.human(&path)),
                }
            }
            Picked::Export(Some(path), format, id) => self.start_export(ctx, path, format, id),
            Picked::Open(None) | Picked::SaveAs(None, _, _) | Picked::Export(None, _, _) => {}
        }
    }

    /// Si otro programa cambió un archivo: sin cambios propios se vuelve a leer; con cambios, se
    /// avisa (no se pisa nada).
    fn check_disk(&mut self, now: f64) {
        if now - self.disk_check < 2.0 {
            return;
        }
        self.disk_check = now;
        for i in 0..self.tabs.len() {
            let Some(t) = self.tabs.get(i) else { continue };
            if !t.doc.changed_on_disk() {
                continue;
            }
            let Some(path) = t.doc.path.clone() else { continue };
            if t.doc.dirty() {
                let name = path.file_name().map_or_else(String::new, |n| n.to_string_lossy().into_owned());
                self.notice = Some(format!(
                    "«{name}»: {}",
                    pick(
                        "another program changed this file; saving will replace its version.",
                        "otro programa cambió este archivo; al guardar se reemplaza su versión.",
                    )
                ));
                if let Some(t) = self.tabs.get_mut(i) {
                    t.doc.mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
                }
            } else if let Ok(d) = Doc::open(&path) {
                let id = self.new_id();
                if let Some(t) = self.tabs.get_mut(i) {
                    // Estado de editor nuevo para el texto nuevo.
                    *t = Tab::new(d, id);
                }
            }
        }
    }

    /// Avisos (exportado, errores) en una franja bajo la barra de formato.
    fn notices(&mut self, ui: &mut egui::Ui) {
        if self.info.is_none() && self.notice.is_none() {
            return;
        }
        let c = iurefficient_ui::theme::colors(ui);
        let frame = egui::Frame::new().fill(c.surface_alt).inner_margin(egui::Margin::symmetric(12, 4));
        egui::Panel::top("iureditor-notices").frame(frame).resizable(false).show(ui, |ui| {
            if let Some(n) = self.info.clone() {
                ui.horizontal(|ui| {
                    ui.label(n);
                    if self.exporting.is_none() && ui.small_button(pick("Close", "Cerrar")).clicked() {
                        self.info = None;
                    }
                });
            }
            if let Some(n) = self.notice.clone() {
                ui.horizontal(|ui| {
                    ui.colored_label(c.danger, n);
                    if ui.small_button(pick("Close", "Cerrar")).clicked() {
                        self.notice = None;
                    }
                });
            }
        });
    }

    /// Lo elegido en el menú ☰.
    fn menu_act(&mut self, ctx: &egui::Context, a: crate::chrome::MenuAct) {
        use crate::chrome::MenuAct;
        match a {
            MenuAct::New => self.push_tab(Doc::default()),
            MenuAct::Open => self.open_dialog(),
            MenuAct::Save => {
                self.save(None);
            }
            MenuAct::SaveAs => self.save_as_dialog(None),
            MenuAct::Export(f) => {
                if self.exporting.is_none() {
                    self.export_dialog(f);
                }
            }
            MenuAct::CloseTab => self.act(ctx, Then::CloseTab),
            MenuAct::Quit => ctx.send_viewport_cmd(egui::ViewportCommand::Close),
            MenuAct::Undo => self.apply_to_active(ctx, iure_doc_ui::ExternalEdit::Undo),
            MenuAct::Redo => self.apply_to_active(ctx, iure_doc_ui::ExternalEdit::Redo),
            MenuAct::ToggleSidebar => self.side.open = !self.side.open,
            MenuAct::FindInFiles => {
                self.side.open = true;
                self.side.tab = crate::sidebar::SideTab::Search;
                self.side.focus_search = true;
            }
            MenuAct::ZoomIn => self.set_zoom(iure_doc_ui::zoom_step(self.zoom, true)),
            MenuAct::ZoomOut => self.set_zoom(iure_doc_ui::zoom_step(self.zoom, false)),
            MenuAct::ZoomReset => self.set_zoom(1.0),
            MenuAct::Theme(mode) => {
                self.theme = mode;
                iurefficient_ui::theme::apply(ctx, mode, self.look.density);
                if let Some(f) = &self.prefs {
                    crate::drafts::save_theme(f, mode);
                }
            }
            MenuAct::Font(k) => self.set_look(ctx, |l| l.font = k),
            MenuAct::TextScale(p) => self.set_look(ctx, |l| l.text_scale = p),
            MenuAct::Crisp(c) => self.set_look(ctx, |l| l.crisp = c),
            MenuAct::Density(d) => self.set_look(ctx, |l| l.density = d),
            MenuAct::About => self.about = true,
            MenuAct::Side(tab) => {
                if self.side.open && self.side.tab == tab {
                    self.side.open = false;
                } else {
                    self.side.open = true;
                    self.side.tab = tab;
                }
            }
            MenuAct::OpenFolder => self.side_act(ctx, crate::sidebar::SideAct::PickFolder),
            MenuAct::FromTemplate(name) => {
                // Con campos `{{clave}}`, primero se piden; si no, se crea directo.
                let fields = self.templates.as_deref().map(|d| crate::templates::fields(d, &name)).unwrap_or_default();
                if fields.is_empty() {
                    self.new_from_template(&name, &[]);
                } else {
                    self.template_ask = Some((name, fields.into_iter().map(|f| (f, String::new())).collect()));
                }
            }
            MenuAct::OpenTemplatesFolder => {
                if let Some(d) = self.templates.clone() {
                    crate::templates::ensure(&d);
                    ctx.open_url(egui::OpenUrl::new_tab(format!("file://{}", d.display())));
                }
            }
            MenuAct::OpenRecent(p) => self.open_path(&p),
            MenuAct::QuickSwitcher => {
                let root = self.side.folder(self.doc().path.as_deref());
                match (root, self.notes.clone()) {
                    (Some(r), Some(n)) => self.palette = Some(crate::palette::Palette::notes(&r, &n.files())),
                    _ => {
                        self.notice = Some(
                            pick(
                                "Open a folder or save the document to find its notes.",
                                "Abre una carpeta o guarda el documento para buscar sus notas.",
                            )
                            .to_string(),
                        );
                    }
                }
            }
            MenuAct::CommandPalette => self.palette = Some(crate::palette::Palette::commands()),
            MenuAct::Find | MenuAct::Replace => {
                self.source = false;
                if let (Some(id), Some(t)) = (self.editor_id(), self.tabs.get(self.active)) {
                    iure_doc_ui::open_find(ctx, id, &t.doc.text, matches!(a, MenuAct::Replace));
                }
            }
            MenuAct::GotoLine => self.goto_line = Some(String::new()),
            MenuAct::InsertToc => {
                let toc = toc_of(&self.doc().text);
                if toc.is_empty() {
                    self.notice =
                        Some(pick("The document has no headings.", "El documento no tiene títulos.").to_string());
                } else {
                    self.apply_to_active(ctx, iure_doc_ui::ExternalEdit::Insert(toc));
                }
            }
            MenuAct::SelectAll => {
                if let (Some(id), Some(t)) = (self.editor_id(), self.tabs.get(self.active)) {
                    iure_doc_ui::select_all(ctx, id, &t.doc.text);
                }
            }
            MenuAct::SourceCode => self.source = !self.source,
            // Solo los números: se ven con el texto con formato y en el código fuente.
            MenuAct::LineNumbers => {
                self.line_numbers = !self.line_numbers;
                self.save_pref("line_numbers", serde_json::json!(self.line_numbers));
            }
            MenuAct::PageWidth(w) => {
                self.page = w;
                self.save_pref("page_width", serde_json::json!(w.key()));
            }
            MenuAct::Spellcheck(on) => {
                self.spell_on = on;
                self.save_pref("spellcheck", serde_json::json!(on));
            }
            MenuAct::Language(l) => {
                self.lang = l;
                iurefficient_ui::lang::set_lang(l.lang());
                self.save_pref("language", serde_json::json!(l.key()));
                ctx.request_repaint();
            }
            MenuAct::Help => match crate::drafts::data_dir().map(|d| d.join("ayuda")) {
                Some(dir) => match crate::help::write_to(&dir) {
                    Ok(p) => self.open_path(&p),
                    Err(e) => {
                        self.notice =
                            Some(format!("{} ({e})", pick("Could not open the help", "No se pudo abrir la ayuda")))
                    }
                },
                None => self.notice = Some(pick("No data folder.", "No hay carpeta de datos.").to_string()),
            },
            MenuAct::Url(u) => ctx.open_url(egui::OpenUrl::new_tab(u)),
            MenuAct::CheckUpdates => {
                if self.updating.is_none() {
                    self.update = None;
                    self.updating = Some(crate::updates::start());
                }
                self.about = true;
            }
        }
    }

    /// Un documento nuevo (sin guardar) desde la plantilla `name` con estos campos.
    fn new_from_template(&mut self, name: &str, fields: &[(String, String)]) {
        let filled = self
            .templates
            .as_deref()
            .ok_or_else(|| pick("No data folder.", "No hay carpeta de datos.").to_string())
            .and_then(|d| crate::templates::fill(d, name, fields, crate::templates::today()));
        match filled {
            // Nace sin guardar: «Guardar» pide dónde (la plantilla no se toca).
            Ok(text) => self.push_tab(Doc { path: None, saved: String::new(), text, mtime: None }),
            Err(e) => self.notice = Some(e),
        }
    }

    /// Los cuadros de la app: ir a línea, paleta, acerca de (con la búsqueda de actualizaciones).
    fn dialogs(&mut self, ctx: &egui::Context) {
        if let Some((name, mut fields)) = self.template_ask.take() {
            let mut keep = true;
            let mut create = false;
            egui::Window::new(format!("{} «{name}»", pick("New from template", "Nueva desde plantilla")))
                .id(egui::Id::unique("iureditor-template-fields"))
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_TOP, [0.0, 80.0])
                .show(ctx, |ui| {
                    ui.label(pick("Fill in the template fields:", "Completa los campos de la plantilla:"));
                    ui.add_space(4.0);
                    egui::Grid::new("iureditor-template-grid").num_columns(2).spacing([10.0, 6.0]).show(ui, |ui| {
                        for (i, (k, v)) in fields.iter_mut().enumerate() {
                            let l = ui.label(k.as_str());
                            let r = ui.add(egui::TextEdit::singleline(v).desired_width(260.0));
                            let r = r.labelled_by(l.id);
                            if i == 0 && !ui.memory(|m| m.focused().is_some()) {
                                r.request_focus();
                            }
                            ui.end_row();
                        }
                    });
                    ui.add_space(6.0);
                    let (enter, esc) = ui.input_mut(|i| {
                        (i.consume_key(Modifiers::COMMAND, Key::Enter), i.consume_key(Modifiers::NONE, Key::Escape))
                    });
                    ui.horizontal(|ui| {
                        if iurefficient_ui::primary_button(ui, pick("Create", "Crear")).clicked() || enter {
                            create = true;
                        }
                        if ui.button(pick("Cancel", "Cancelar")).clicked() || esc {
                            keep = false;
                        }
                    });
                    ui.label(
                        egui::RichText::new(pick(
                            "Empty fields stay as {{field}}.",
                            "Los campos vacíos quedan como {{campo}}.",
                        ))
                        .small()
                        .color(iurefficient_ui::theme::colors(ui).text_muted),
                    );
                });
            if create {
                // Lo vacío queda como estaba (`{{campo}}`), para llenarlo después.
                let filled: Vec<(String, String)> = fields.into_iter().filter(|(_, v)| !v.trim().is_empty()).collect();
                self.new_from_template(&name, &filled);
            } else if keep {
                self.template_ask = Some((name, fields));
            }
        }
        if let Some(rx) = &self.updating {
            match rx.try_recv() {
                Ok(c) => {
                    self.update = Some(c);
                    self.updating = None;
                }
                Err(mpsc::TryRecvError::Disconnected) => self.updating = None,
                Err(mpsc::TryRecvError::Empty) => ctx.request_repaint_after(std::time::Duration::from_millis(200)),
            }
        }
        if let Some(mut p) = self.palette.take() {
            match crate::palette::show(ctx, &mut p) {
                None => self.palette = Some(p),
                Some(Some(a)) => self.menu_act(ctx, a),
                Some(None) => {}
            }
        }
        if let Some(mut q) = self.goto_line.take() {
            let mut keep = true;
            let mut go = None;
            let lines = self.doc().text.split('\n').count();
            egui::Window::new(pick("Go to line", "Ir a línea"))
                .id(egui::Id::unique("iureditor-goto"))
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_TOP, [0.0, 80.0])
                .show(ctx, |ui| {
                    ui.label(format!("{} (1–{lines})", pick("Line number", "Número de línea")));
                    let r = ui.add(egui::TextEdit::singleline(&mut q).desired_width(160.0));
                    r.request_focus();
                    let (enter, esc) = ui.input_mut(|i| {
                        (i.consume_key(Modifiers::NONE, Key::Enter), i.consume_key(Modifiers::NONE, Key::Escape))
                    });
                    ui.horizontal(|ui| {
                        if ui.button(pick("Go", "Ir")).clicked() || enter {
                            go = q.trim().parse::<usize>().ok();
                            keep = false;
                        }
                        if ui.button(pick("Cancel", "Cancelar")).clicked() || esc {
                            keep = false;
                        }
                    });
                });
            if let Some(n) = go {
                let n = n.clamp(1, lines.max(1));
                let at: usize = self.doc().text.split('\n').take(n - 1).map(|l| l.chars().count() + 1).sum();
                self.source = false;
                self.goto(ctx, at);
            }
            if keep {
                self.goto_line = Some(q);
            }
        }
        if self.about {
            let mut open = true;
            let mut download = false;
            let mut check = false;
            egui::Window::new(pick("About IureEditor", "Acerca de IureEditor"))
                .id(egui::Id::unique("iureditor-about"))
                .open(&mut open)
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    let c = iurefficient_ui::theme::colors(ui);
                    ui.set_width(360.0);
                    ui.vertical_centered(|ui| {
                        ui.label(egui::RichText::new("IureEditor").size(22.0).strong());
                        ui.label(format!("{} {}", pick("Version", "Versión"), env!("CARGO_PKG_VERSION")));
                        ui.add_space(4.0);
                        ui.label(
                            egui::RichText::new(pick(
                                "Markdown document editor of the Iurefficient suite, written in Rust.",
                                "Editor de documentos Markdown de la suite Iurefficient, escrito en Rust.",
                            ))
                            .color(c.text_muted),
                        );
                        ui.add_space(6.0);
                        ui.label("© Eduardo Llaguno Velasco · Apache-2.0");
                        ui.hyperlink_to("iurefficient.com", "https://iurefficient.com");
                        ui.add_space(8.0);
                        use crate::updates::Check;
                        match (&self.updating, &self.update) {
                            (Some(_), _) => {
                                ui.horizontal(|ui| {
                                    ui.spinner();
                                    ui.label(pick("Checking for updates…", "Buscando actualizaciones…"));
                                });
                            }
                            (None, Some(Check::UpToDate)) => {
                                ui.label(pick("You have the latest version.", "Tienes la versión más reciente."));
                            }
                            (None, Some(Check::Newer(v))) => {
                                ui.label(
                                    egui::RichText::new(format!(
                                        "{} {v}.",
                                        pick("A new version is available:", "Hay una versión nueva:")
                                    ))
                                    .strong(),
                                );
                                if ui.button(pick("Download…", "Descargar…")).clicked() {
                                    download = true;
                                }
                            }
                            (None, Some(Check::Failed(e))) => {
                                ui.label(egui::RichText::new(e.as_str()).color(c.text_muted));
                            }
                            (None, None) => {
                                if ui.button(pick("Check for updates…", "Buscar actualizaciones…")).clicked() {
                                    check = true;
                                }
                            }
                        }
                    });
                });
            if download {
                ctx.open_url(egui::OpenUrl::new_tab(crate::updates::RELEASES));
            }
            if check {
                self.menu_act(ctx, crate::chrome::MenuAct::CheckUpdates);
            }
            if !open || ctx.input(|i| i.key_pressed(Key::Escape)) {
                self.about = false;
            }
        }
    }

    /// Lo que pide el panel lateral.
    fn side_act(&mut self, ctx: &egui::Context, a: crate::sidebar::SideAct) {
        use crate::sidebar::SideAct;
        match a {
            SideAct::Open(p, at) => {
                self.open_path(&p);
                if let Some(at) = at {
                    self.goto(ctx, at);
                }
            }
            SideAct::Goto(at) => self.goto(ctx, at),
            SideAct::Renamed(from, to) => {
                for t in &mut self.tabs {
                    if t.doc.path.as_deref() == Some(from.as_path()) {
                        t.doc.path = Some(to.clone());
                    }
                }
            }
            SideAct::Iure(a) => self.iure_act(a),
            SideAct::Follow(l) => self.follow_link(ctx, &l),
            SideAct::Assist(a) => {
                use crate::assistant::AssistAct;
                match a {
                    AssistAct::Insert(t) => {
                        self.apply_to_active(ctx, iure_doc_ui::ExternalEdit::Insert(format!("\n\n{t}\n")))
                    }
                    AssistAct::Replace(t) => self.apply_to_active(ctx, iure_doc_ui::ExternalEdit::Replace(t)),
                    AssistAct::Connect => self.side.tab = crate::sidebar::SideTab::Iurefficient,
                }
            }
            SideAct::PickFolder => {
                let (tx, rx) = mpsc::channel();
                let start = self.side.folder(self.doc().path.as_deref());
                std::thread::spawn(move || {
                    let mut d = rfd::FileDialog::new();
                    if let Some(s) = start {
                        d = d.set_directory(s);
                    }
                    let _ = tx.send(d.pick_folder());
                });
                self.side.picking = Some(rx);
            }
        }
    }

    /// Lo que pide la pestaña Iurefficient.
    fn iure_act(&mut self, a: crate::iure::IureAct) {
        use crate::iure::IureAct;
        match a {
            IureAct::Open(p) => self.open_path(&p),
            IureAct::SaveAndUpload => {
                let Some(p) = self.doc().path.clone() else { return };
                if self.doc().dirty() {
                    // Guardar ya sube (si está activo «subir al guardar»); si no, se sube aquí.
                    let auto = self.side.iure.autosync();
                    if self.save(None) && !auto {
                        self.side.iure.upload(&p);
                    }
                } else {
                    self.side.iure.upload(&p);
                }
            }
            IureAct::SaveNew { case_id, case_title } => {
                let Some(p) = self.doc().path.clone() else {
                    self.notice = Some(
                        pick(
                            "Save the document on your computer first (Ctrl+S).",
                            "Guarda primero el documento en tu equipo (Ctrl+S).",
                        )
                        .to_string(),
                    );
                    return;
                };
                if self.doc().dirty() && !self.save(None) {
                    return;
                }
                self.side.iure.save_new(&p, case_id, case_title);
            }
        }
    }

    /// Ctrl+clic en un enlace: `[[nota#título]]` abre (o crea) la nota; una dirección web, el
    /// navegador; una ruta relativa a un Markdown, ese archivo.
    pub(crate) fn follow_link(&mut self, ctx: &egui::Context, link: &str) {
        let from = self.doc().path.clone();
        if let Some((note, head)) = crate::notes::split_wiki(link) {
            let Some(idx) = self.notes.clone() else {
                self.notice = Some(
                    pick(
                        "Save the document to link it with other notes.",
                        "Guarda el documento para enlazarlo con otras notas.",
                    )
                    .to_string(),
                );
                return;
            };
            if note.is_empty() {
                // `[[#título]]`: en este documento.
                if let Some(h) = head {
                    self.goto_heading(ctx, &h);
                }
                return;
            }
            let path = match idx.resolve(&note, from.as_deref()) {
                Some(p) => p,
                None => {
                    let made = idx.new_path(&note, from.as_deref()).filter(|p| {
                        p.parent().is_some_and(|d| std::fs::create_dir_all(d).is_ok())
                            && std::fs::OpenOptions::new().write(true).create_new(true).open(p).is_ok()
                    });
                    match made {
                        Some(p) => p,
                        None => {
                            self.notice = Some(format!(
                                "{} «{note}».",
                                pick("Could not create the note", "No se pudo crear la nota")
                            ));
                            return;
                        }
                    }
                }
            };
            self.open_path(&path);
            if let Some(h) = head {
                self.goto_heading(ctx, &h);
            }
            return;
        }
        // `[texto](#ancla)`: un título de este documento.
        if let Some(anchor) = link.strip_prefix('#') {
            self.goto_heading(ctx, anchor);
            return;
        }
        let lower = link.to_ascii_lowercase();
        if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:") {
            ctx.open_url(egui::OpenUrl::new_tab(link));
            return;
        }
        // Un enlace Markdown a otro archivo, relativo al documento.
        let rel = link.split('#').next().unwrap_or(link);
        if let Some(dir) = from.as_deref().and_then(std::path::Path::parent) {
            let p = dir.join(rel);
            if !rel.is_empty() && !rel.contains("..") && p.is_file() {
                self.open_path(&p);
            }
        }
    }

    /// Lleva el cursor al título `h` del documento activo (sin mayúsculas).
    fn goto_heading(&mut self, ctx: &egui::Context, h: &str) {
        let want = h.trim().to_lowercase();
        // Por el texto del título o por su ancla (`#22-c_saldo18-…`, como GitHub o Pandoc).
        let key = crate::sidebar::anchor_key(h);
        let at = crate::sidebar::outline(&self.doc().text)
            .into_iter()
            .find(|(_, t, _)| t.to_lowercase() == want || (!key.is_empty() && crate::sidebar::anchor_key(t) == key));
        if let Some((_, _, at)) = at {
            self.goto(ctx, at);
        }
    }

    /// Aplica la apariencia: fuente, nitidez, tema con su densidad y tamaño del texto.
    fn apply_look(&self, ctx: &egui::Context) {
        let choice = iurefficient_ui::fonts::FontChoice::from_key(&self.look.font);
        iurefficient_ui::fonts::set_crisp_text(ctx, self.look.crisp);
        iurefficient_ui::fonts::install_choice(ctx, &choice);
        iurefficient_ui::theme::apply(ctx, self.theme, self.look.density);
        iurefficient_ui::system::set_text_scale(ctx, self.look.text_scale as f32 / 100.0);
    }

    /// Cambia la apariencia, la aplica y la guarda.
    fn set_look(&mut self, ctx: &egui::Context, f: impl FnOnce(&mut crate::drafts::Appearance)) {
        f(&mut self.look);
        self.apply_look(ctx);
        if let Some(p) = &self.prefs {
            crate::drafts::save_appearance(p, &self.look);
        }
    }

    /// Lleva el cursor de la pestaña activa al carácter `at`.
    fn goto(&mut self, ctx: &egui::Context, at: usize) {
        if let Some(t) = self.tabs.get(self.active) {
            iure_doc_ui::focus_offset(ctx, egui::Id::unique(("iureditor-doc", t.id)), &t.doc.text, at);
        }
    }

    /// Una acción de la barra de formato (o del menú) en el editor de la pestaña activa.
    pub(crate) fn apply_to_active(&mut self, ctx: &egui::Context, e: iure_doc_ui::ExternalEdit) {
        let Some(t) = self.tabs.get_mut(self.active) else { return };
        iure_doc_ui::apply_external(ctx, egui::Id::unique(("iureditor-doc", t.id)), &mut t.doc.text, e);
    }

    /// Línea del cursor, palabras y caracteres del documento activo (barra de estado).
    pub(crate) fn counts(&self, ctx: &egui::Context) -> (usize, usize, usize) {
        let Some(t) = self.tabs.get(self.active) else { return (1, 0, 0) };
        let text = &t.doc.text;
        let line = iure_doc_ui::caret_offset(ctx, egui::Id::unique(("iureditor-doc", t.id)), text)
            .map_or(1, |c| text.chars().take(c).filter(|ch| *ch == '\n').count() + 1);
        (line, text.split_whitespace().count(), text.chars().count())
    }

    /// Las pestañas en la barra de título: un clic cambia, «×» (o el botón del medio) cierra.
    pub(crate) fn tab_strip(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let c = iurefficient_ui::theme::colors(ui);
        let mut select = None;
        let mut close = None;
        let mut new_tab = false;
        egui::ScrollArea::horizontal().id_salt("iureditor-tabs").auto_shrink([false, true]).show(ui, |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 2.0;
                for (i, t) in self.tabs.iter().enumerate() {
                    let label = t.label();
                    let active = i == self.active;
                    // Una pestaña: su nombre (recortado) y «×»; la activa con el fondo del documento.
                    let font = if active {
                        iurefficient_ui::theme::semibold_font(&ctx, 13.5)
                    } else {
                        egui::FontId::proportional(13.5)
                    };
                    let g = iurefficient_ui::widgets::text::elided(
                        ui,
                        &label,
                        font,
                        if active { c.text } else { c.text_muted },
                        190.0,
                    );
                    let w = g.size().x + 44.0;
                    let (rect, r) = ui.allocate_exact_size(egui::vec2(w, 30.0), egui::Sense::click());
                    if active {
                        ui.painter().rect_filled(rect, 7.0, c.surface);
                    } else if r.hovered() {
                        ui.painter().rect_filled(rect, 7.0, c.hover);
                    }
                    ui.painter().galley(egui::pos2(rect.left() + 12.0, rect.center().y - g.size().y / 2.0), g, c.text);
                    r.widget_info(|| egui::WidgetInfo::selected(egui::Role::Tab, true, active, label.clone()));
                    let r =
                        r.on_hover_text(t.doc.path.as_ref().map_or_else(|| label.clone(), |p| p.display().to_string()));
                    if r.clicked() {
                        select = Some(i);
                    }
                    if r.middle_clicked() {
                        close = Some(i);
                    }
                    // «×»: siempre en la activa; en las demás, al pasar el ratón.
                    let xr = egui::Rect::from_center_size(
                        egui::pos2(rect.right() - 16.0, rect.center().y),
                        egui::vec2(20.0, 20.0),
                    );
                    let x = ui.interact(xr, ui.scope_id().with(("close-tab", t.id)), egui::Sense::click());
                    if active || r.hovered() || x.hovered() {
                        if x.hovered() {
                            ui.painter().rect_filled(xr, 4.0, c.hover);
                        }
                        iurefficient_ui::icons::paint(
                            ui.painter(),
                            xr.shrink(5.0),
                            Icon::Close,
                            c.text_muted,
                            c.text_muted,
                        );
                    }
                    let name = format!("{} {label}", pick("Close", "Cerrar"));
                    x.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, name.clone()));
                    if x.on_hover_text(ctx.format_shortcut(&CLOSE_TAB)).clicked() {
                        close = Some(i);
                    }
                }
                ui.add_space(4.0);
                let plus = iurefficient_ui::icons::icon_button(ui, Icon::Plus, pick("New tab", "Pestaña nueva"), true);
                if plus.clicked() {
                    new_tab = true;
                }
            });
        });
        if new_tab {
            self.push_tab(Doc::default());
        }
        if let Some(i) = select {
            self.active = i;
        }
        if let Some(i) = close {
            self.active = i;
            self.act(&ctx, Then::CloseTab);
        }
    }

    fn ask_window(&mut self, ctx: &egui::Context) {
        let Some(then) = self.ask else { return };
        let name = self.tabs.get(self.active).map(Tab::label).unwrap_or_default();
        let name = name.trim_start_matches("• ").to_string();
        let mut answer: Option<Option<bool>> = None;
        egui::Window::new(pick("Save changes?", "¿Guardar los cambios?"))
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, egui::Vec2::ZERO)
            .show(ctx, |ui| {
                ui.label(format!("«{name}» {}", pick("has changes that are not saved.", "tiene cambios sin guardar.")));
                ui.horizontal(|ui| {
                    if ui.button(pick("Save", "Guardar")).clicked() {
                        answer = Some(Some(true));
                    }
                    if ui.button(pick("Don't save", "No guardar")).clicked() {
                        answer = Some(Some(false));
                    }
                    if ui.button(pick("Cancel", "Cancelar")).clicked() || ui.input(|i| i.key_pressed(Key::Escape)) {
                        answer = Some(None);
                    }
                });
            });
        match answer {
            Some(Some(true)) => {
                self.ask = None;
                if self.save(Some(then)) {
                    self.run(ctx, then);
                }
            }
            Some(Some(false)) => {
                self.ask = None;
                if let Some(t) = self.tab_mut() {
                    t.doc.saved = t.doc.text.clone();
                }
                // «No guardar»: sin borrador huérfano.
                let i = self.active;
                self.clear_draft(i);
                self.run(ctx, then);
            }
            Some(None) => self.ask = None,
            None => {}
        }
    }

    /// Atajos de las pestañas (antes que el editor).
    fn tab_keys(&mut self, ctx: &egui::Context) {
        let n = self.tabs.len();
        let (new, close, next, prev) = ctx.input_mut(|i| {
            let new = i.consume_shortcut(&NEW_TAB) || i.consume_shortcut(&NEW);
            let close = i.consume_shortcut(&CLOSE_TAB);
            let shift_cmd = Modifiers { shift: true, ..Modifiers::COMMAND };
            let prev = i.consume_key(shift_cmd, Key::Tab) || i.consume_key(Modifiers::COMMAND, Key::PageUp);
            let next = (!prev && i.consume_key(Modifiers::COMMAND, Key::Tab))
                || i.consume_key(Modifiers::COMMAND, Key::PageDown);
            (new, close, next, prev)
        });
        if new {
            self.push_tab(Doc::default());
        }
        if close {
            self.act(ctx, Then::CloseTab);
        }
        if next && n > 0 {
            self.active = (self.active + 1) % n;
        }
        if prev && n > 0 {
            self.active = (self.active + n - 1) % n;
        }
    }

    /// Un cuadro de la ventana.
    pub fn ui(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        if !self.themed {
            self.themed = true;
            // La tipografía de la suite (Inter con sus pesos: los títulos y la negrita se ven).
            self.apply_look(&ctx);
            iurefficient_ui::system::watch_system_theme(&ctx);
            // Ctrl + / Ctrl − agrandan el documento, no toda la interfaz.
            ctx.options_mut(|o| o.zoom_with_keyboard = false);
        }
        iurefficient_ui::theme::refresh(&ctx);
        // Cerrar la ventana: pestaña por pestaña las que tienen cambios; luego, la sesión.
        if ctx.input(|i| i.viewport().close_requested()) && !self.closing {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.run(&ctx, Then::Close);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE_AS)) {
            self.save_as_dialog(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&SAVE)) {
            self.save(None);
        }
        if ctx.input_mut(|i| i.consume_shortcut(&OPEN)) {
            self.open_dialog();
        }
        let shift = Modifiers { shift: true, ..Modifiers::COMMAND };
        for (key, tab) in [
            (Key::E, crate::sidebar::SideTab::Files),
            (Key::O, crate::sidebar::SideTab::Outline),
            (Key::I, crate::sidebar::SideTab::Iurefficient),
            (Key::J, crate::sidebar::SideTab::Assistant),
        ] {
            if ctx.input_mut(|i| i.consume_key(shift, key)) {
                self.side.open = true;
                self.side.tab = tab;
            }
        }
        if ctx.input_mut(|i| i.consume_shortcut(&FIND_ALL)) {
            self.menu_act(&ctx, crate::chrome::MenuAct::FindInFiles);
        }
        {
            use crate::chrome::{self as ch, MenuAct as M};
            for (k, a) in [
                (ch::LINKS, M::Side(crate::sidebar::SideTab::Links)),
                (ch::SOURCE, M::SourceCode),
                (ch::LINE_NUMBERS, M::LineNumbers),
                (ch::PAGE_WIDTH, M::PageWidth(self.page.next())),
                (ch::GOTO_LINE, M::GotoLine),
                (ch::QUICK, M::QuickSwitcher),
                (ch::PALETTE, M::CommandPalette),
                (ch::HELP, M::Help),
            ] {
                // Ctrl+Mayús+K también es «enlace» en el editor: mientras se escribe, es suyo.
                if k == ch::LINKS && ctx.egui_wants_keyboard_input() {
                    continue;
                }
                if ctx.input_mut(|i| i.consume_shortcut(&k)) {
                    self.menu_act(&ctx, a);
                }
            }
        }
        if ctx.input_mut(|i| i.consume_shortcut(&QUIT)) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        self.zoom_keys(&ctx);
        self.tab_keys(&ctx);
        self.poll_picker(&ctx);
        self.poll_export();
        self.poll_incoming(&ctx);
        self.draft_tick(&ctx);
        self.check_disk(ctx.input(|i| i.time));
        let title = self.doc().title();
        if title != self.title {
            ctx.send_viewport_cmd(egui::ViewportCommand::Title(title.clone()));
            self.title = title;
        }
        // El marco: barra de título (☰, pestañas, botones de la ventana), barra de formato,
        // avisos y barra de estado.
        let chrome = self.chrome.clone();
        if let Some(a) = crate::chrome::title_bar(self, ui, chrome.as_ref()) {
            self.menu_act(&ctx, a);
        }
        if let Some(a) = crate::chrome::status_bar(self, ui) {
            self.menu_act(&ctx, a);
        }
        // Las notas que puede enlazar `[[`: las de la carpeta del panel o del documento.
        let folder = self.side.folder(self.doc().path.as_deref());
        if self.notes.as_ref().map(|n| &n.root) != folder.as_ref() {
            self.notes = folder.map(|f| std::sync::Arc::new(crate::notes::FolderNotes::new(f)));
        }
        self.side.poll();
        if let Some(a) = self.side.iure.poll() {
            self.iure_act(a);
        }
        if self.side.open {
            let (path, text, caret, selection) = match self.tabs.get(self.active) {
                Some(t) => {
                    let id = egui::Id::unique(("iureditor-doc", t.id));
                    let sel = iure_doc_ui::selection(&ctx, id, &t.doc.text)
                        .map(|(a, b)| t.doc.text.chars().skip(a).take(b - a).collect::<String>());
                    (t.doc.path.clone(), t.doc.text.clone(), iure_doc_ui::caret_offset(&ctx, id, &t.doc.text), sel)
                }
                None => (None, String::new(), None, None),
            };
            let notes = self.notes.clone();
            if let Some(a) = self.side.show(ui, path.as_deref(), &text, caret, notes.as_deref(), selection.as_deref()) {
                self.side_act(&ctx, a);
            }
        }
        crate::chrome::format_bar(self, ui);
        self.notices(ui);
        let bg = iurefficient_ui::theme::colors(ui).surface;
        egui::CentralPanel::default()
            // Sin margen a los lados: la barra de desplazamiento va en la orilla y el editor pone
            // el margen del texto (`gutter`).
            .frame(egui::Frame::new().fill(bg).inner_margin(egui::Margin { left: 0, right: 0, top: 12, bottom: 0 }))
            .show(ui, |ui| {
                let speller = self.speller.clone();
                let notes = self.notes.clone();
                let (page, spell_on, source, line_numbers) = (self.page, self.spell_on, self.source, self.line_numbers);
                let Some(t) = self.tabs.get_mut(self.active) else { return };
                if source {
                    source_view(ui, &mut t.doc.text, line_numbers, page);
                    return;
                }
                // Diagramas (Mermaid, mapas mentales) e imágenes de la carpeta del documento,
                // dibujados en su lugar.
                let folder = t.doc.path.as_ref().and_then(|p| p.parent()).map(std::path::Path::to_path_buf);
                let diagrams: std::sync::Arc<dyn iure_doc_ui::DiagramRenderer> =
                    std::sync::Arc::new(iure_doc_ui::Renderers(vec![
                        std::sync::Arc::new(crate::diagrams::Diagrams::new(ui)),
                        std::sync::Arc::new(crate::diagrams::Formulas::new(ui, self.zoom * DOC_SCALE)),
                        std::sync::Arc::new(iure_doc_ui::LocalImages::new(folder.clone())),
                    ]));
                // Pegar de la web, Word o Google Docs pega su Markdown (el HTML del portapapeles).
                let hooks = iure_doc_ui::Hooks {
                    diagrams: Some(diagrams),
                    paste: Some(std::sync::Arc::new(iure_doc_ui::SystemClipboard)),
                    spell: spell_on.then_some(speller),
                    // Imágenes pegadas o soltadas: en `assets/` junto al documento (como la versión
                    // Tauri).
                    images: Some(std::sync::Arc::new(iure_doc_ui::FolderImages::new(folder, "assets"))),
                    // Letra de documento (algo mayor que la de la interfaz), por el zoom elegido.
                    zoom: Some(self.zoom * DOC_SCALE),
                    notes: notes.map(|n| n as std::sync::Arc<dyn iure_doc_ui::NoteIndex>),
                    math: Some(std::sync::Arc::new(crate::diagrams::Formulas::inline(ui, self.zoom * DOC_SCALE))),
                    page: Some(page.ems()),
                    // Con números de línea, un margen más ancho para que quepan.
                    gutter: Some(if line_numbers { 44.0 } else { 28.0 }),
                    line_numbers,
                };
                // La columna de documento la pone el editor.
                let out = iure_doc_ui::show_blocks_hooks(
                    ui,
                    egui::Id::unique(("iureditor-doc", t.id)),
                    &mut t.doc.text,
                    pick("Write here… (# title, - list, **bold**)", "Escribe aquí… (# título, - lista, **negrita**)"),
                    hooks,
                );
                out.response.widget_info(|| {
                    egui::WidgetInfo::labeled(egui::Role::MultilineTextInput, true, pick("Document", "Documento"))
                });
                if out.link.is_some() {
                    self.clicked_link = out.link;
                }
            });
        if let Some(l) = self.clicked_link.take() {
            self.follow_link(&ctx, &l);
        }
        if let Some(ch) = &chrome {
            iurefficient_ui::window::frame(ui, ch, egui::Id::unique("iureditor-window"));
        }
        self.ask_window(&ctx);
        self.recovery_window(&ctx);
        self.dialogs(&ctx);
    }
}

/// Ver › Código fuente: el Markdown tal cual, en monoespaciado, con números de línea si se piden.
fn source_view(ui: &mut egui::Ui, text: &mut String, line_numbers: bool, page: crate::drafts::PageWidth) {
    let size = iurefficient_ui::theme::body_font(ui.ctx()).size;
    let font = egui::FontId::monospace(size);
    egui::ScrollArea::vertical().id_salt("iureditor-source").auto_shrink([false, false]).show(ui, |ui| {
        let full = ui.available_width();
        let col = (full - 56.0).min(size * page.ems() * 1.1).max(200.0);
        ui.horizontal_top(|ui| {
            ui.add_space(((full - col) / 2.0).max(28.0));
            if line_numbers {
                let c = iurefficient_ui::theme::colors(ui);
                let n = text.split('\n').count();
                let nums: String = (1..=n).map(|i| format!("{i}\n")).collect();
                ui.add(
                    egui::Label::new(egui::RichText::new(nums).font(font.clone()).color(c.text_muted))
                        .selectable(false),
                );
            }
            let r = ui.add(
                egui::TextEdit::multiline(text)
                    .id(egui::Id::unique("iureditor-source-edit"))
                    .font(font.clone())
                    .code_editor()
                    .frame(egui::Frame::NONE)
                    .desired_width(col)
                    .desired_rows(30),
            );
            r.widget_info(|| {
                egui::WidgetInfo::labeled(egui::Role::MultilineTextInput, true, pick("Source code", "Código fuente"))
            });
        });
    });
}

/// Índice del documento: una lista con un enlace a cada título (anclas como GitHub).
pub(crate) fn toc_of(text: &str) -> String {
    let heads = crate::sidebar::outline(text);
    let Some(min) = heads.iter().map(|(l, _, _)| *l).min() else { return String::new() };
    let mut out = String::from("\n");
    for (level, title, _) in heads {
        let indent = "  ".repeat(usize::from(level.saturating_sub(min)));
        out.push_str(&format!("{indent}- [{title}](#{})\n", crate::sidebar::slug(&title)));
    }
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::Harness;
    use egui_kittest::kittest::Queryable;

    /// Nueva desde plantilla con campos: un cuadro los pide y el documento nace con ellos (lo
    /// vacío queda como `{{campo}}`), sin guardar.
    #[test]
    fn templates_ask_for_their_fields() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Carta.md"),
            "# Carta a {{cliente}}\n\nExpediente {{ expediente }}, {{fecha}}.\n",
        )
        .unwrap();
        let mut app = EditorApp::new(Doc::default(), None);
        app.templates = Some(dir.path().to_path_buf());
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 700.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        let ctx = h.ctx.clone();
        h.state_mut().menu_act(&ctx, crate::chrome::MenuAct::FromTemplate("Carta".into()));
        h.run_steps(2);
        assert!(h.query_by_label("cliente").is_some() && h.query_by_label("expediente").is_some());
        h.get_by_label("cliente").focus();
        h.run();
        h.get_by_label("cliente").type_text("Altamira");
        h.run();
        h.get_by_label("Crear").click();
        h.run_steps(2);
        let d = h.state().doc();
        assert!(d.text.starts_with("# Carta a Altamira"), "{}", d.text);
        assert!(d.text.contains("Expediente {{ expediente }}"), "lo vacío queda: {}", d.text);
        assert!(!d.text.contains("{{fecha}}"), "la fecha se pone sola");
        assert!(d.path.is_none() && d.dirty(), "nace sin guardar");
    }

    /// Edición › Insertar índice, enlaces `#ancla` que llevan al título, Acerca de y el ancho de
    /// página guardado.
    #[test]
    fn toc_anchors_about_and_page_width() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let t = "# Informe\n\n## 2.2 C_SALDO[1..8]: la escalera\n\ntexto\n\n### Más\n";
        let toc = toc_of(t);
        assert!(toc.contains("- [Informe](#informe)"), "{toc}");
        // El esquema quita las marcas (`_`): el ancla queda como la de Pandoc.
        assert!(toc.contains("  - [2.2 CSALDO[1..8]: la escalera](#22-csaldo18-la-escalera)"), "{toc}");
        assert!(toc.contains("    - [Más](#más)"), "{toc}");
        let dir = tempfile::tempdir().unwrap();
        let prefs = dir.path().join("preferencias.json");
        let doc = Doc { path: None, saved: t.into(), text: t.into(), mtime: None };
        let app = EditorApp::new(doc, None).with_prefs(prefs.clone());
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 700.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run_steps(2);
        // Un ancla de Pandoc (sin el guion bajo) también llega al título.
        let ctx = h.ctx.clone();
        h.state_mut().follow_link(&ctx, "#22-csaldo18-la-escalera");
        h.run_steps(3);
        let id = h.state().tabs.get(h.state().active).map(|t| t.id).unwrap_or(0);
        let at = iure_doc_ui::caret_offset(&h.ctx, egui::Id::unique(("iureditor-doc", id)), t);
        assert_eq!(at, Some("# Informe\n\n".chars().count()), "el cursor en el título del ancla");
        // Acerca de: un cuadro con la versión.
        h.state_mut().menu_act(&ctx, crate::chrome::MenuAct::About);
        h.run_steps(2);
        assert!(h.query_by_label_contains(env!("CARGO_PKG_VERSION")).is_some(), "la versión en Acerca de");
        // Ancho de página: se guarda y se lee.
        h.state_mut().menu_act(&ctx, crate::chrome::MenuAct::PageWidth(crate::drafts::PageWidth::Full));
        let again = EditorApp::new(Doc::default(), None).with_prefs(prefs);
        assert_eq!(again.page, crate::drafts::PageWidth::Full);
    }

    #[test]
    fn typing_marks_the_document_unsaved_and_ctrl_s_saves() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "# Título\n\nTexto\n").unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text("¡");
        h.run();
        assert!(h.state().doc().dirty());
        assert!(h.state().title.starts_with("• "));
        h.key_press_modifiers(Modifiers::COMMAND, Key::S);
        h.run();
        assert!(!h.state().doc().dirty());
        // Al enfocar, el cursor queda al final del primer bloque.
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Título¡\n\nTexto\n");
    }

    #[test]
    fn new_opens_a_tab_and_closing_a_changed_tab_asks() {
        let d = Doc { text: "borrador".into(), ..Default::default() };
        let app = EditorApp::new(d, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        // «+» (pestaña nueva): otra pestaña; el borrador sigue en la suya.
        h.get_by_label("Pestaña nueva").click();
        h.run();
        assert_eq!(h.state().tabs.len(), 2);
        assert!(h.state().doc().text.is_empty());
        // Volver a la pestaña con cambios y cerrarla: pregunta.
        h.get_by_label("• Sin título").click();
        h.run();
        assert_eq!(h.state().doc().text, "borrador");
        h.key_press_modifiers(Modifiers::COMMAND, Key::W);
        h.run();
        assert_eq!(h.state().ask, Some(Then::CloseTab));
        h.get_by_label("No guardar").click();
        h.run();
        assert_eq!(h.state().tabs.len(), 1);
        assert!(h.state().doc().text.is_empty() && h.state().ask.is_none());
    }
}

#[cfg(test)]
mod diagram_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    #[test]
    fn mermaid_blocks_are_drawn_in_place() {
        let text = "Plan\n\n```mermaid\ngraph LR; A --> B\n```\n";
        let doc = Doc { saved: text.into(), text: text.into(), ..Default::default() };
        let app = EditorApp::new(doc, None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        // El dibujo llega de otro hilo (Blitz).
        let mut seen = false;
        for _ in 0..600 {
            h.step();
            if h.query_by_label("Diagrama 2").is_some() {
                seen = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(seen, "el diagrama se ve dibujado");
        assert_eq!(h.state().doc().text, text, "dibujarlo no cambia el documento");
    }

    #[test]
    fn images_next_to_the_document_are_shown_in_place() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("img")).unwrap();
        image::RgbaImage::from_pixel(8, 8, image::Rgba([0, 90, 180, 255]))
            .save(dir.path().join("img/punto.png"))
            .unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "![Punto azul](img/punto.png)\n").unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        let mut seen = false;
        for _ in 0..300 {
            h.step();
            if h.query_by_label("Imagen 1: Punto azul").is_some() {
                seen = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(seen, "la imagen junto al documento se ve en su lugar");
    }
}

#[cfg(test)]
mod tab_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    fn harness(app: EditorApp) -> egui_kittest::Harness<'static, EditorApp> {
        egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app)
    }

    fn file(dir: &std::path::Path, name: &str, text: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn shortcuts_switch_tabs_and_an_open_file_is_not_opened_twice() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "A\n"), file(dir.path(), "b.md", "B\n"));
        let mut app = EditorApp::new(Doc::default(), None);
        // La pestaña nueva y vacía se reutiliza al abrir.
        app.open_path(&a);
        assert_eq!(app.tabs.len(), 1);
        app.open_path(&b);
        assert_eq!((app.tabs.len(), app.active), (2, 1));
        app.open_path(&a);
        assert_eq!((app.tabs.len(), app.active), (2, 0), "ya abierto: pasa a su pestaña");
        let mut h = harness(app);
        h.run();
        h.key_press_modifiers(Modifiers::COMMAND, Key::Tab);
        h.run();
        assert_eq!(h.state().active, 1);
        h.key_press_modifiers(Modifiers { shift: true, ..Modifiers::COMMAND }, Key::Tab);
        h.run();
        assert_eq!(h.state().active, 0);
        h.key_press_modifiers(Modifiers::COMMAND, Key::T);
        h.run();
        assert_eq!((h.state().tabs.len(), h.state().active), (3, 2));
        assert!(h.query_by_label("b.md").is_some() && h.query_by_label("Sin título").is_some());
    }

    #[test]
    fn each_tab_keeps_its_own_text_and_undo() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "Uno\n"), file(dir.path(), "b.md", "Dos\n"));
        let app = EditorApp::with_docs(vec![Doc::open(&a).unwrap(), Doc::open(&b).unwrap()], 0, None);
        let mut h = harness(app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text(" más");
        h.run_steps(2);
        h.get_by_label("b.md").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Dos\n");
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text("!");
        h.run_steps(2);
        h.get_by_label("• a.md").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Uno más\n");
        h.get_by_label("Documento").focus();
        h.run();
        h.key_press_modifiers(Modifiers::COMMAND, Key::Z);
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "Uno\n", "deshacer solo en su pestaña");
        assert_eq!(h.state().tabs.get(1).map(|t| t.doc.text.as_str()), Some("Dos!\n"));
    }

    #[test]
    fn closing_the_window_asks_tab_by_tab_and_saves_the_session() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (file(dir.path(), "a.md", "A\n"), file(dir.path(), "b.md", "B\n"));
        let mut da = Doc::open(&a).unwrap();
        da.text.push('x');
        let mut db = Doc::open(&b).unwrap();
        db.text.push('y');
        let mut app = EditorApp::with_docs(vec![da, db, Doc::default()], 2, None);
        let session = dir.path().join("datos/sesion.json");
        app.set_session_file(session.clone());
        let mut h = harness(app);
        h.run();
        let ctx = h.ctx.clone();
        h.state_mut().run(&ctx, Then::Close);
        h.run();
        assert!(h.query_by_label_contains("«a.md» tiene cambios").is_some(), "la primera con cambios");
        h.get_by_label("No guardar").click();
        h.run();
        assert!(h.query_by_label_contains("«b.md» tiene cambios").is_some(), "luego la siguiente");
        // El «Guardar» de la pregunta (el otro es el de la barra).
        h.get_all_by_label("Guardar").last().unwrap().click();
        h.run_steps(2);
        assert!(h.state().closing);
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "B\ny", "la segunda se guardó");
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "A\n", "la primera, no");
        // La sesión: los documentos con archivo y la última pestaña que se vio (b.md).
        assert_eq!(crate::drafts::load_session(&session), (vec![a, b], 1));
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[derive(Debug)]
    struct Dropped(PathBuf);

    impl egui::DroppedFile for Dropped {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
        fn bytes(&self) -> Result<Vec<u8>, String> {
            std::fs::read(&self.0).map_err(|e| e.to_string())
        }
    }

    #[test]
    fn dropped_images_go_to_assets_next_to_the_document() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "Texto\n").unwrap();
        let outside = tempfile::tempdir().unwrap();
        let src = outside.path().join("logo.png");
        image::RgbaImage::from_pixel(4, 4, image::Rgba([10, 20, 30, 255])).save(&src).unwrap();
        let app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run_steps(2);
        h.input_mut().dropped_files.push(std::sync::Arc::new(Dropped(src)));
        // La imagen entra cuando un bloque toma el foco: unos cuadros, más con la máquina ocupada.
        for _ in 0..60 {
            h.run_steps(1);
            if h.state().doc().text.contains("![logo]") {
                break;
            }
        }
        assert_eq!(h.state().doc().text, "Texto\n\n![logo](assets/logo.png)\n");
        assert!(dir.path().join("assets/logo.png").is_file());
    }
}

#[cfg(test)]
mod chrome_tests {
    use super::*;
    use egui_kittest::Harness;
    use egui_kittest::kittest::Queryable;

    /// Ctrl+clic en `[[nota]]`: abre la nota de la carpeta; si no existe, la crea junto al
    /// documento; `[[nota#título]]` lleva al título.
    #[test]
    fn wiki_links_open_or_create_notes() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("inicio.md");
        std::fs::write(&doc, "Ver [[Acta]]\n").unwrap();
        std::fs::write(dir.path().join("Acta.md"), "# Acta\n\ntexto\n\n## Pagos\n").unwrap();
        let app = EditorApp::new(Doc::open(&doc).unwrap(), None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        let ctx = h.ctx.clone();
        h.state_mut().follow_link(&ctx, "[[acta#pagos]]");
        h.run_steps(3);
        assert_eq!(h.state().doc().path.as_deref(), Some(dir.path().join("Acta.md").as_path()));
        h.state_mut().follow_link(&ctx, "[[Temas/Nueva nota]]");
        h.run_steps(2);
        let made = dir.path().join("Temas/Nueva nota.md");
        assert!(made.is_file(), "se crea con su carpeta");
        assert_eq!(h.state().tabs.len(), 3);
        h.state_mut().follow_link(&ctx, "[[../fuera]]");
        h.run();
        assert!(!dir.path().parent().unwrap().join("fuera.md").exists());
    }

    /// Mapa mental: clic en el centro del dibujo y «Añadir rama hija» agrega una rama a la lista.
    #[test]
    fn the_node_bar_adds_a_child_branch() {
        use egui_kittest::kittest::Queryable;
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let text = "Intro\n\n> [!MINDMAP|map] Centro\n> - Uno\n> - Dos\n> - Tres\n> - Cuatro\n";
        let app = EditorApp::new(Doc { text: text.into(), saved: text.into(), ..Default::default() }, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 700.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        let mut rect = None;
        for _ in 0..800 {
            h.step();
            rect = h.query_by_label("Diagrama 2").map(|n| n.rect());
            if rect.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        rect.expect("el mapa se dibujó");
        // Que se asiente la distribución (las alturas estimadas cambian al dibujar).
        h.run_steps(10);
        let r = h.get_by_label("Diagrama 2").rect();
        let p = r.center();
        h.event(egui::Event::PointerMoved(p));
        for pressed in [true, false] {
            h.event(egui::Event::PointerButton {
                pos: p,
                button: egui::PointerButton::Primary,
                pressed,
                modifiers: Modifiers::NONE,
            });
        }
        h.run_steps(3);
        assert!(h.query_by_label("Añadir rama hija").is_some(), "la barra del nodo");
        h.get_by_label("Añadir rama hija").click();
        h.run_steps(3);
        assert!(h.state().doc().text.contains("> - Cuatro\n> - Nueva rama"), "{:?}", h.state().doc().text);
    }

    /// Con la lista a la vista (debajo): la barra del nodo agrega la rama y deja el cursor en ella.
    #[test]
    fn the_node_bar_works_with_the_list_in_view() {
        use egui_kittest::kittest::Queryable;
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let text = "Intro\n\n> [!MINDMAP] Centro\n> - Uno\n> - Dos\n> - Tres\n> - Cuatro\n";
        let app = EditorApp::new(Doc { text: text.into(), saved: text.into(), ..Default::default() }, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 900.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        for _ in 0..800 {
            h.step();
            if h.query_by_label("Dibujo del diagrama").is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        h.run_steps(10);
        let r = h.get_by_label("Dibujo del diagrama").rect();
        let p = r.center();
        h.event(egui::Event::PointerMoved(p));
        for pressed in [true, false] {
            h.event(egui::Event::PointerButton {
                pos: p,
                button: egui::PointerButton::Primary,
                pressed,
                modifiers: Modifiers::NONE,
            });
        }
        h.run_steps(3);
        assert!(h.query_by_label("Añadir rama hija").is_some(), "la barra del nodo");
        h.get_by_label("Añadir rama hija").click();
        h.run_steps(3);
        assert!(h.state().doc().text.contains("> - Cuatro\n> - Nueva rama"), "{:?}", h.state().doc().text);
    }

    /// Zoom: Ctrl + / Ctrl − / Ctrl 0 y la barra de estado (− 100 % +), solo para el documento.
    #[test]
    fn zoom_keys_and_status_bar_change_the_document_size() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let app = EditorApp::new(Doc { text: "Hola\n".into(), ..Default::default() }, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        h.key_press_modifiers(Modifiers::COMMAND, Key::Equals);
        h.run();
        assert!((h.state().zoom - 1.1).abs() < 1e-4, "{}", h.state().zoom);
        assert!((h.ctx.zoom_factor() - 1.0).abs() < 1e-4, "la interfaz no cambia");
        h.get_by_label("110 %").click();
        h.run();
        assert!((h.state().zoom - 1.0).abs() < 1e-4);
        h.get_by_label("−").click();
        h.run();
        assert!((h.state().zoom - 0.9).abs() < 1e-4);
        h.key_press_modifiers(Modifiers::COMMAND, Key::Num0);
        h.run();
        assert!((h.state().zoom - 1.0).abs() < 1e-4);
    }

    /// Color del texto y resaltado desde la barra: la paleta de la 1.x sobre la selección.
    #[test]
    fn the_format_bar_paints_the_selection() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let app = EditorApp::new(Doc { text: "Hola mundo\n".into(), ..Default::default() }, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        let ctx = h.ctx.clone();
        let id = ctx.memory(|m| m.focused()).unwrap();
        let mut st = egui::text_edit::TextEditState::load(&ctx, id).unwrap_or_default();
        st.cursor.set_char_range(Some(egui::text::CCursorRange::two(
            egui::text::CCursor::new(5),
            egui::text::CCursor::new(10),
        )));
        st.store(&ctx, id);
        h.run();
        h.get_by_label("Color del texto").click();
        h.run();
        h.get_by_label("#FF0000").click();
        h.run_steps(3);
        assert_eq!(h.state().doc().text, "Hola <span style=\"color: #FF0000\">mundo</span>\n");
        h.get_by_label("Resaltar").click();
        h.run();
        h.get_by_label("#FFF2CC").click();
        h.run_steps(3);
        assert!(
            h.state().doc().text.contains("<mark style=\"background-color: #FFF2CC\">"),
            "{}",
            h.state().doc().text
        );
    }

    /// La barra de formato y el menú ☰ (marco como la 1.x).
    #[test]
    fn format_bar_and_menu_act_on_the_document() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let app = EditorApp::new(Doc { text: "Hola mundo\n".into(), ..Default::default() }, None);
        let mut h = Harness::builder()
            .with_size(egui::vec2(1000.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        h.run();
        // Sin cursor todavía: el título va a la última línea (la única).
        h.get_by_label("Título 1").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "# Hola mundo\n");
        h.get_by_label("Lista de tareas").click();
        h.run_steps(2);
        assert!(h.state().doc().text.starts_with("- [ ] "), "{:?}", h.state().doc().text);
        h.get_by_label("Deshacer (Ctrl+Z)").click();
        h.run_steps(2);
        assert_eq!(h.state().doc().text, "# Hola mundo\n");
        // La barra de estado.
        assert!(h.query_by_label_contains("palabras").is_some());
        assert!(h.query_by_label("Cambios sin guardar").is_some());
        // El esquema del panel lateral: un clic lleva el cursor al título.
        h.get_by_label("Pestaña nueva").click();
        h.run();
        let t = "# Uno\n\ntexto\n\n## Dos\n\nmás\n".to_string();
        if let Some(tab) = h.state_mut().tab_mut() {
            tab.doc.text = t.clone();
        }
        h.run_steps(2);
        h.get_by_label("Dos").click();
        h.run_steps(3);
        let id = h.state().tabs.get(h.state().active).map(|t| t.id).unwrap_or(0);
        let at = iure_doc_ui::caret_offset(&h.ctx, egui::Id::unique(("iureditor-doc", id)), &t);
        assert_eq!(at, Some("# Uno\n\ntexto\n\n".chars().count()), "el cursor en «Dos»");
        // El menú ☰: Archivo › Nuevo abre una pestaña.
        h.get_by_label("Menú").click();
        h.run();
        h.get_by_label("Nuevo").click();
        h.run();
        assert_eq!(h.state().tabs.len(), 3);
    }
}

#[cfg(test)]
mod draft_tests {
    use super::*;
    use egui_kittest::kittest::Queryable;

    fn harness(app: EditorApp) -> egui_kittest::Harness<'static, EditorApp> {
        egui_kittest::Harness::builder()
            .with_size(egui::vec2(900.0, 600.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app)
    }

    /// El borrador de la primera pestaña de esta ventana.
    fn my_draft(dir: &std::path::Path) -> PathBuf {
        dir.join(format!("{}-1.json", std::process::id()))
    }

    /// Espera a que un archivo exista (o no) — lo escribe otro hilo.
    fn wait_file(p: &std::path::Path, exists: bool) -> bool {
        for _ in 0..200 {
            if p.exists() == exists {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        false
    }

    #[test]
    fn unsaved_changes_leave_a_draft_until_saved() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("nota.md");
        std::fs::write(&p, "Texto\n").unwrap();
        let mut app = EditorApp::new(Doc::open(&p).unwrap(), None);
        let drafts = dir.path().join("borradores");
        app.set_drafts_dir(drafts.clone());
        let mut h = harness(app);
        h.run();
        h.get_by_label("Documento").focus();
        h.run();
        h.get_by_label("Documento").type_text(" nuevo");
        // Antes de 2,5 s, nada; después (cada paso son 0,25 s), el borrador.
        h.run_steps(4);
        assert!(!my_draft(&drafts).exists());
        h.run_steps(8);
        assert!(wait_file(&my_draft(&drafts), true), "borrador escrito");
        let d = crate::drafts::orphans(&drafts);
        assert!(d.iter().any(|(_, x)| x.text.contains("nuevo") && x.path.as_deref() == Some(p.as_path())));
        h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::S);
        h.run_steps(2);
        assert!(wait_file(&my_draft(&drafts), false), "al guardar se borra");
    }

    #[test]
    fn dont_save_removes_the_draft() {
        let dir = tempfile::tempdir().unwrap();
        let drafts = dir.path().join("borradores");
        let mut app = EditorApp::new(Doc { text: "borrador".into(), ..Default::default() }, None);
        app.set_drafts_dir(drafts.clone());
        let mut h = harness(app);
        h.run_steps(12);
        assert!(wait_file(&my_draft(&drafts), true));
        h.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::W);
        h.run();
        h.get_by_label("No guardar").click();
        h.run_steps(2);
        assert!(wait_file(&my_draft(&drafts), false));
    }

    #[test]
    fn a_draft_from_a_crash_can_be_recovered() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("contrato.md");
        std::fs::write(&p, "Versión guardada\n").unwrap();
        let drafts = dir.path().join("borradores");
        std::fs::create_dir_all(&drafts).unwrap();
        let orphan = drafts.join("4000000.json");
        std::fs::write(
            &orphan,
            serde_json::json!({"path": p.to_string_lossy(), "text": "Versión sin guardar\n", "saved_at": 1, "pid": 4_000_000u32})
                .to_string(),
        )
        .unwrap();
        let mut app = EditorApp::new(Doc::default(), None);
        app.set_drafts_dir(drafts.clone());
        app.recovery = crate::drafts::orphans(&drafts);
        let mut h = harness(app);
        h.run();
        assert!(h.query_by_label_contains("contrato.md").is_some(), "dice qué documento era");
        h.get_by_label("Recuperar").click();
        h.run_steps(2);
        let doc = h.state().doc();
        assert_eq!(doc.text, "Versión sin guardar\n");
        assert_eq!(doc.saved, "Versión guardada\n", "el archivo no se toca: queda con cambios sin guardar");
        assert_eq!(doc.path.as_deref(), Some(p.as_path()));
        assert!(!orphan.exists(), "recuperado, se borra");
    }
}

#[cfg(test)]
mod links_tests {
    use super::*;

    #[test]
    fn links_open_and_dictate_into_documents() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        std::fs::write(&a, "Hola").unwrap();
        let ctx = egui::Context::default();
        let mut app = EditorApp::new(Doc::default(), None);
        // Abrir por enlace: la pestaña vacía se reemplaza.
        let link = format!("iureditor://open?path={}", a.display());
        app.handle_args(&ctx, vec![link]);
        assert_eq!(app.tabs.len(), 1);
        assert_eq!(app.doc().path.as_deref(), Some(a.as_path()));
        // Dictado: al final (sin cursor), con deshacer por voz.
        app.handle_args(&ctx, vec!["iureditor://insert?text=%20mundo".into()]);
        assert_eq!(app.doc().text, "Hola mundo");
        assert!(app.doc().dirty(), "queda por guardar: el enlace nunca guarda");
        app.handle_args(&ctx, vec!["iureditor://edit?action=undo".into()]);
        assert_eq!(app.doc().text, "Hola");
        // Con `path` de otro documento: se abre y se escribe en él.
        let b = dir.path().join("b.md");
        std::fs::write(&b, "B").unwrap();
        app.handle_args(&ctx, vec![format!("iureditor://insert?text=!&path={}", b.display())]);
        assert_eq!(app.tabs.len(), 2);
        assert_eq!(app.doc().text, "B!");
        // Lo que no se entiende se dice, no se ejecuta.
        app.handle_args(&ctx, vec!["iureditor://borrar?path=%2Ftmp".into()]);
        assert!(app.notice.as_deref().is_some_and(|n| n.contains("No se entiende")));
        app.notice = None;
        app.handle_args(&ctx, vec!["iureditor://insert?text=x&path=%2Fno%2Fexiste.md".into()]);
        assert!(app.notice.as_deref().is_some_and(|n| n.contains("No existe")));
    }
}

/// Captura de la ventana: `IUREDITOR_SHOT=/tmp/x.png cargo test shot -- --ignored`.
#[cfg(test)]
mod shot {
    use super::*;

    /// `IUREDITOR_SHOT_SIZE=ANCHOxALTO` (por omisión 1000x700).
    fn shot_size() -> egui::Vec2 {
        std::env::var("IUREDITOR_SHOT_SIZE")
            .ok()
            .and_then(|s| {
                let (w, h) = s.split_once('x')?;
                Some(egui::vec2(w.parse().ok()?, h.parse().ok()?))
            })
            .unwrap_or(egui::vec2(1000.0, 700.0))
    }

    #[test]
    #[ignore = "captura para revisar la interfaz"]
    fn shot() {
        let Some(out) = std::env::var_os("IUREDITOR_SHOT") else { return };
        let text = "# Propuesta para Altamira\n\nAcuerdos de la **reunión** del martes con *Ana* y [el despacho](https://x.mx); falta la aceptacion del cliente. Honorarios: $h \\cdot \\frac{3}{4}$ del total.\n\n## Pendientes\n\n- [ ] Llamar al notario\n- [x] Enviar propuesta\n  - con anexos\n\n> Nota: revisar `contrato.md` antes del jueves.\n\n> [!TIP]\n> Llevar copia firmada a la audiencia.\n\n$$\n\\text{Total} = \\sum_{i=1}^{n} h_i \\cdot \\frac{1500}{1 + \\tau}\n$$\n\n| Concepto | Monto |\n|---|--:|\n| Honorarios | 12 000 |\n\n```rust\n// Honorarios por hora\nfn honorarios(horas: u32) -> u32 {\n    horas * 1_500 // pesos\n}\n```\n\n```mermaid\ngraph LR; Propuesta --> Firma --> Audiencia\n```\n\n> [!MINDMAP|map] Estrategia\n> - Análisis\n>   - Contrato\n> - Negociación\n";
        // Una carpeta con una imagen junto al documento (se ve en su lugar).
        let dir = std::env::temp_dir().join(format!("iureditor-shot-{}", std::process::id()));
        let _ = std::fs::create_dir_all(dir.join("img"));
        let logo = image::RgbaImage::from_fn(360, 120, |x, y| {
            let t = x as f32 / 360.0;
            image::Rgba([
                (30.0 + 40.0 * t) as u8,
                (64.0 + 80.0 * t) as u8,
                175,
                if (x / 12 + y / 12) % 7 == 0 { 230 } else { 255 },
            ])
        });
        let _ = logo.save(dir.join("img/sello.png"));
        let text = text.replacen("\n\n## Pendientes", "\n\n![Sello del despacho](img/sello.png)\n\n## Pendientes", 1);
        // `IUREDITOR_SHOT_MAP=<metadato>`: solo un mapa mental (con ese metadato: ``, `right`, `map`…).
        let text = match std::env::var("IUREDITOR_SHOT_MAP") {
            Ok(meta) => format!(
                "# Planeación\n\n> [!MINDMAP{}] CDS\n> - Productos\n>   - SABI\n>   - NextSABI\n>   - VoiceTrade\n> - Plan venta\n>   - Afirme\n>   - Kapital\n> - Nube CDS\n> - Servicios\n>   - Soporte\n>   - Mantenimiento\n>   - Integración\n> - Ventaja competitiva\n>   - Versatilidad\n>   - Confiabilidad\n",
                if meta.is_empty() { String::new() } else { format!("|{meta}") }
            ),
            Err(_) => text,
        };
        // `IUREDITOR_SHOT_SIDE=links`: notas que enlazan y mencionan la propuesta.
        let links = std::env::var("IUREDITOR_SHOT_SIDE").as_deref() == Ok("links");
        let text = if links {
            let _ = std::fs::write(dir.join("Minuta 12-11.md"), "# Minuta\n\nSe revisó la [[propuesta]] con Ana.\n");
            let _ = std::fs::write(dir.join("Contrato de arrendamiento.md"), "# Contrato\n");
            let _ = std::fs::write(dir.join("Pendientes.md"), "- Enviar la propuesta firmada al cliente\n");
            text.replacen(
                "falta la aceptacion del cliente.",
                "falta la aceptacion del cliente. Ver [[Contrato de arrendamiento]] y [[Anexo B]].",
                1,
            )
        } else {
            text
        };
        // `IUREDITOR_SHOT_FILE=<ruta>`: un documento propio en vez del de muestra.
        let text =
            std::env::var_os("IUREDITOR_SHOT_FILE").and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or(text);
        let doc = Doc { path: Some(dir.join("propuesta.md")), saved: text.clone(), text, mtime: None };
        let mut app = EditorApp::new(doc, None);
        // La barra de título propia (con los botones de la ventana de GNOME).
        app.chrome = iurefficient_ui::window::WindowChrome::named("adwaita");
        // `IUREDITOR_SHOT_TABS=1`: dos pestañas más (una con cambios), la primera activa.
        if std::env::var_os("IUREDITOR_SHOT_TABS").is_some() {
            let mut c = Doc { path: Some("contrato-arrendamiento.md".into()), ..Default::default() };
            c.text = "# Contrato\n".into();
            app.push_tab(c);
            app.push_tab(Doc { path: Some("minuta-12-10.md".into()), ..Default::default() });
            app.active = 0;
        }
        // `IUREDITOR_SHOT_SIDE=files|iure|login`: esa pestaña del panel lateral.
        match std::env::var("IUREDITOR_SHOT_SIDE").as_deref() {
            Ok("files") => app.side.tab = crate::sidebar::SideTab::Files,
            Ok("links") => app.side.tab = crate::sidebar::SideTab::Links,
            Ok("assistant") => {
                app.side.tab = crate::sidebar::SideTab::Assistant;
                app.side.iure.status = Some(crate::iure::Status::Ready {
                    name: "Ana Pérez".into(),
                    email: "ana@despacho.mx".into(),
                    host: "despacho.iurefficient.com".into(),
                    case_label: "caso".into(),
                });
                app.side.assistant.demo();
            }
            Ok("login") => {
                app.side.tab = crate::sidebar::SideTab::Iurefficient;
                app.side.iure.status = Some(crate::iure::Status::LoggedOut);
                app.side.iure.domain = "despacho.iurefficient.com".into();
            }
            Ok("iure") => {
                app.side.tab = crate::sidebar::SideTab::Iurefficient;
                app.side.iure.status = Some(crate::iure::Status::Ready {
                    name: "Ana Pérez".into(),
                    email: "ana@despacho.mx".into(),
                    host: "despacho.iurefficient.com".into(),
                    case_label: "caso".into(),
                });
                let k = |n: &str, t: &str, c: &str| iurefficient_connect::api::CaseSummary {
                    id: n.into(),
                    case_number: n.into(),
                    title: t.into(),
                    status: "open".into(),
                    client_name: Some(c.into()),
                    client_id: None,
                };
                app.side.iure.apps = Some((iurefficient_connect::apps::installed(), false));
                app.side.iure.cases = vec![
                    k("2026-014", "Arrendamiento Altamira", "Inmobiliaria Altamira"),
                    k("2026-021", "Despido injustificado", "Juan Gómez"),
                    k("2026-033", "Constitución de sociedad", "Café del Puerto"),
                ];
            }
            _ => {}
        }
        // `IUREDITOR_SHOT_RECOVERY=1`: la ventana para recuperar un borrador.
        if std::env::var_os("IUREDITOR_SHOT_RECOVERY").is_some() {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            app.recovery = vec![(
                PathBuf::from("/nada"),
                crate::drafts::Draft {
                    path: Some("contrato.md".into()),
                    text: "x".into(),
                    saved_at: now - 600,
                    pid: 1,
                },
            )];
        }
        let mut h = egui_kittest::Harness::builder()
            .with_size(shot_size())
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        // `IUREDITOR_SHOT_LIGHT=1`: tema claro (como las capturas de la 1.x).
        if std::env::var_os("IUREDITOR_SHOT_LIGHT").is_some() {
            h.state_mut().themed = true;
            // `IUREDITOR_SHOT_FONT=inter|system|family:<nombre>` (por omisión, la de la apariencia).
            let font = std::env::var("IUREDITOR_SHOT_FONT").unwrap_or_else(|_| h.state().look.font.clone());
            iurefficient_ui::fonts::install_choice(&h.ctx, &iurefficient_ui::fonts::FontChoice::from_key(&font));
            iurefficient_ui::theme::apply(&h.ctx, iurefficient_ui::theme::ThemeMode::Light, Default::default());
        }
        h.run_steps(4);
        // `IUREDITOR_SHOT_NOSIDE=1`: sin panel lateral; `IUREDITOR_SHOT_SCROLL=<px>`: desplazado.
        if std::env::var_os("IUREDITOR_SHOT_NOSIDE").is_some() {
            h.state_mut().side.open = false;
            h.run_steps(2);
        }
        // `IUREDITOR_SHOT_MENU=<sección>,…`: el menú ☰ abierto; se pulsan esas secciones en orden.
        if let Ok(sec) = std::env::var("IUREDITOR_SHOT_MENU") {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Menú").click();
            h.run_steps(2);
            for sec in sec.split(',').filter(|s| !s.is_empty()) {
                h.get_by_label(sec).click();
                // Lo que se despliega se anima: se espera a que termine.
                h.run_steps(30);
            }
        }
        // `IUREDITOR_SHOT_LINES=1`: con números de línea.
        if std::env::var_os("IUREDITOR_SHOT_LINES").is_some() {
            h.state_mut().line_numbers = true;
            h.run_steps(2);
        }
        // `IUREDITOR_SHOT_ABOUT=1`: Acerca de.
        if std::env::var_os("IUREDITOR_SHOT_ABOUT").is_some() {
            let ctx = h.ctx.clone();
            h.state_mut().menu_act(&ctx, crate::chrome::MenuAct::About);
            h.run_steps(3);
        }
        if let Some(px) = std::env::var("IUREDITOR_SHOT_SCROLL").ok().and_then(|p| p.parse::<f32>().ok()) {
            let r = h.ctx.content_rect();
            h.event(egui::Event::PointerMoved(r.center()));
            h.event(egui::Event::MouseWheel {
                unit: egui::MouseWheelUnit::Point,
                delta: egui::vec2(0.0, -px),
                modifiers: egui::Modifiers::NONE,
                phase: egui::TouchPhase::Move,
                source: egui::MouseWheelSource::Wheel,
            });
            h.run_steps(4);
        }
        // Los diagramas llegan de otro hilo: se espera a que estén dibujados.
        for _ in 0..600 {
            h.step();
            use egui_kittest::kittest::Queryable;
            if h.query_all_by_label_contains("Diagrama").count() >= 3
                && h.query_all_by_label_contains("Imagen").count() >= 1
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        // Las gramáticas del código se cargan en otro hilo.
        let _ = iure_doc_ui::wait_highlighting(std::time::Duration::from_secs(20));
        // El corrector carga los diccionarios en otro hilo.
        for _ in 0..500 {
            if h.state().speller.is_ready() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        h.run_steps(2);
        // `IUREDITOR_SHOT_NODE=1` (con `IUREDITOR_SHOT_MAP=map`): clic en el centro del mapa.
        if std::env::var_os("IUREDITOR_SHOT_NODE").is_some() {
            use egui_kittest::kittest::Queryable;
            let rect = h.query_by_label("Diagrama 2").map(|n| n.rect());
            if let Some(r) = rect {
                let p = r.center();
                h.event(egui::Event::PointerMoved(p));
                for pressed in [true, false] {
                    h.event(egui::Event::PointerButton {
                        pos: p,
                        button: egui::PointerButton::Primary,
                        pressed,
                        modifiers: Modifiers::NONE,
                    });
                }
                h.run_steps(3);
            }
        }
        // `IUREDITOR_SHOT_SLASH=1`: el menú de `/` al final del título.
        // `IUREDITOR_SHOT_FIND=1`: la barra de buscar y reemplazar (Ctrl+H) con «honor».
        for (var, keys) in [("IUREDITOR_SHOT_SLASH", " /dia"), ("IUREDITOR_SHOT_FIND", "honor")] {
            if std::env::var_os(var).is_none() {
                continue;
            }
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Documento").focus();
            h.run_steps(2);
            if var == "IUREDITOR_SHOT_FIND" {
                h.key_press_modifiers(Modifiers::COMMAND, Key::H);
            } else {
                h.key_press(Key::End);
            }
            h.run_steps(2);
            h.event(egui::Event::Text(keys.into()));
            h.run_steps(3);
        }
        // `IUREDITOR_SHOT_SPAN=1`: selección que cruza bloques (de «reunión» a «Pendientes»).
        if std::env::var_os("IUREDITOR_SHOT_SPAN").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Documento").focus();
            h.run_steps(2);
            h.key_press(Key::ArrowDown);
            h.run_steps(2);
            for _ in 0..2 {
                h.key_press_modifiers(Modifiers::SHIFT, Key::ArrowDown);
                h.run_steps(2);
            }
            h.key_press_modifiers(Modifiers::SHIFT, Key::End);
            h.run_steps(3);
        }
        // `IUREDITOR_SHOT_FIND=1`: buscar «propuesta» (Ctrl+F) con sus coincidencias resaltadas.
        if std::env::var_os("IUREDITOR_SHOT_FIND").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Documento").focus();
            h.run_steps(2);
            h.key_press_modifiers(Modifiers::COMMAND, Key::F);
            h.run_steps(2);
            h.get_by_label("Buscar").type_text("propuesta");
            h.run_steps(3);
        }
        // `IUREDITOR_SHOT_CELL=1`: una celda de la tabla con el foco (se ve su barra).
        if std::env::var_os("IUREDITOR_SHOT_CELL").is_some() {
            use egui_kittest::kittest::Queryable;
            h.get_by_label("Fila 2, columna 2").focus();
            h.run_steps(3);
        }
        let img = h.render().unwrap();
        img.save(out).unwrap();
    }
}

/// Tiempo por cuadro al escribir en un documento grande:
/// `IUREDITOR_PERF_FILE=<ruta> cargo test --release perf_typing -- --ignored --nocapture`.
#[cfg(test)]
mod perf {
    use super::*;

    #[test]
    #[ignore = "medición"]
    fn perf_typing() {
        let Some(f) = std::env::var_os("IUREDITOR_PERF_FILE") else { return };
        let text = std::fs::read_to_string(&f).unwrap_or_default();
        let doc = Doc { path: Some(std::path::PathBuf::from(&f)), saved: text.clone(), text, mtime: None };
        let app = EditorApp::new(doc, None);
        let mut h = egui_kittest::Harness::builder()
            .with_size(egui::vec2(1400.0, 900.0))
            .build_ui_state(|ui, a: &mut EditorApp| a.ui(ui), app);
        let t = std::time::Instant::now();
        h.run_steps(3);
        eprintln!("abrir (3 cuadros): {:?}", t.elapsed());
        let mut idle = Vec::new();
        for _ in 0..20 {
            let t = std::time::Instant::now();
            h.step();
            idle.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        eprintln!("en reposo (ms): {:?}", idle.iter().map(|x| x.round() as i64).collect::<Vec<_>>());
        // Clic en el texto y escribir.
        let r = h.ctx.content_rect();
        let p = egui::pos2(r.center().x, r.top() + 220.0);
        h.event(egui::Event::PointerMoved(p));
        h.event(egui::Event::PointerButton {
            pos: p,
            button: egui::PointerButton::Primary,
            pressed: true,
            modifiers: Default::default(),
        });
        h.event(egui::Event::PointerButton {
            pos: p,
            button: egui::PointerButton::Primary,
            pressed: false,
            modifiers: Default::default(),
        });
        h.run_steps(3);
        let mut keys = Vec::new();
        for ch in "escribiendo una frase de prueba ".chars() {
            h.event(egui::Event::Text(ch.to_string()));
            let t = std::time::Instant::now();
            h.step();
            keys.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        eprintln!("por tecla (ms): {:?}", keys.iter().map(|x| x.round() as i64).collect::<Vec<_>>());
        eprintln!("cambió: {}", h.state().doc().text != h.state().doc().saved);
    }
}
