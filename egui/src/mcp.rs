//! `iureditor2 --mcp` (S1.8): IureEditor sin ventana, por MCP sobre stdio (protocolo de
//! `iurefficient_connect::mcp_server`). Para IureDesk, IureVoz, Claude Desktop o Copilot:
//!
//! - `exportar_documento`: un `.md` a PDF, Word o HTML (con imágenes y diagramas).
//! - `convertir_markdown`: un texto Markdown a PDF, Word o HTML, sin archivo de origen.
//! - `html_a_markdown`: HTML (de un correo, de la web) a Markdown limpio.
//! - `listar_plantillas` y `crear_desde_plantilla`: las plantillas de IureEditor; crear nunca
//!   reemplaza un archivo existente.
//!
//! Lo que llega es hostil: rutas absolutas, extensiones según el formato, nada de reemplazar el
//! documento de origen ni de escribir fuera de un archivo nuevo o del destino pedido.

use std::path::{Path, PathBuf};

use iurefficient_connect::mcp_server::{Call, CallError, Handler, Reply, ServerInfo, serve};
use iurefficient_ui::lang::pick;
use serde_json::{Value, json};

use crate::export::{self, Format};
use crate::templates;

/// Markdown más grande que se acepta en una llamada.
const MAX_TEXT: usize = 16 * 1024 * 1024;

pub struct EditorMcp {
    /// Carpeta de plantillas.
    templates: Option<PathBuf>,
}

/// `iureditor2 --mcp`: atiende hasta que el cliente cierre. Stdout es del protocolo.
pub fn run_stdio() -> i32 {
    serve(EditorMcp { templates: templates::dir() })
}

fn err(en: &str, es: &str) -> CallError {
    CallError::Tool(anyhow::anyhow!(pick(en, es).to_string()))
}

fn str_arg<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn format_arg(args: &Value) -> Result<Format, CallError> {
    match str_arg(args, "formato").map(str::to_ascii_lowercase).as_deref() {
        Some("pdf") => Ok(Format::Pdf),
        Some("docx" | "word") => Ok(Format::Docx),
        Some("html") => Ok(Format::Html),
        _ => Err(CallError::Params("formato: pdf, docx o html".into())),
    }
}

/// Una ruta absoluta de los argumentos.
fn abs_path(args: &Value, key: &str) -> Result<Option<PathBuf>, CallError> {
    match str_arg(args, key) {
        None => Ok(None),
        Some(p) => {
            let path = PathBuf::from(p);
            if !path.is_absolute() || p.contains('\0') {
                return Err(CallError::Params(format!("{key}: una ruta absoluta")));
            }
            Ok(Some(path))
        }
    }
}

/// El destino de una exportación: el pedido (con la extensión del formato) o junto al origen.
fn destination(dest: Option<PathBuf>, source: Option<&Path>, format: Format) -> Result<PathBuf, CallError> {
    let out = match (dest, source) {
        (Some(d), _) => d,
        (None, Some(s)) => s.with_extension(format.ext()),
        (None, None) => return Err(CallError::Params("destino: una ruta absoluta".into())),
    };
    let ext_ok = out.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(format.ext()));
    if !ext_ok {
        return Err(err(
            &format!("The destination must end in .{}.", format.ext()),
            &format!("El destino debe terminar en .{}.", format.ext()),
        ));
    }
    if out.is_dir() {
        return Err(err("The destination is a folder.", "El destino es una carpeta."));
    }
    if !out.parent().is_some_and(Path::is_dir) {
        return Err(err("The destination folder does not exist.", "La carpeta del destino no existe."));
    }
    Ok(out)
}

impl EditorMcp {
    fn templates_dir(&self) -> Result<PathBuf, CallError> {
        let d = self.templates.clone().ok_or_else(|| {
            err("IureEditor has no data folder for templates.", "IureEditor no tiene carpeta de datos para plantillas.")
        })?;
        templates::ensure(&d);
        Ok(d)
    }

    fn run(&self, name: &str, args: &Value) -> Result<Reply, CallError> {
        match name {
            "exportar_documento" => {
                let format = format_arg(args)?;
                let src = abs_path(args, "ruta")?.ok_or_else(|| CallError::Params("ruta: el .md".into()))?;
                let doc = crate::doc::Doc::open(&src).map_err(|e| CallError::Tool(anyhow::anyhow!(e.human(&src))))?;
                let out = destination(abs_path(args, "destino")?, Some(&src), format)?;
                if out.canonicalize().ok().is_some_and(|o| src.canonicalize().ok() == Some(o)) {
                    return Err(err("The destination is the document itself.", "El destino es el mismo documento."));
                }
                let base = src.canonicalize().ok().and_then(|p| p.parent().map(Path::to_path_buf));
                export::export(&doc.text, base, format, &out).map_err(|e| CallError::Tool(anyhow::anyhow!(e)))?;
                Ok(Reply::Data(json!({ "destino": out.display().to_string() })))
            }
            "convertir_markdown" => {
                let format = format_arg(args)?;
                let md = args.get("markdown").and_then(Value::as_str).unwrap_or_default();
                if md.len() > MAX_TEXT {
                    return Err(err("The text is too long.", "El texto es demasiado largo."));
                }
                let out = destination(abs_path(args, "destino")?, None, format)?;
                // Sin carpeta de origen: no se incrustan imágenes locales.
                export::export(md, None, format, &out).map_err(|e| CallError::Tool(anyhow::anyhow!(e)))?;
                Ok(Reply::Data(json!({ "destino": out.display().to_string() })))
            }
            "html_a_markdown" => {
                let html = args.get("html").and_then(Value::as_str).unwrap_or_default();
                if html.len() > MAX_TEXT {
                    return Err(err("The HTML is too long.", "El HTML es demasiado largo."));
                }
                Ok(Reply::Data(json!({ "markdown": iure_doc::html::to_markdown(html) })))
            }
            "listar_plantillas" => {
                let d = self.templates_dir()?;
                Ok(Reply::Data(json!({ "plantillas": templates::list(&d), "carpeta": d.display().to_string() })))
            }
            "crear_desde_plantilla" => {
                let name = str_arg(args, "plantilla").ok_or_else(|| CallError::Params("plantilla".into()))?;
                let dest =
                    abs_path(args, "destino")?.ok_or_else(|| CallError::Params("destino: el .md nuevo".into()))?;
                if !dest.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md")) {
                    return Err(err("The new document must end in .md.", "El documento nuevo debe terminar en .md."));
                }
                if dest.exists() {
                    return Err(err(
                        "That file already exists; nothing was replaced.",
                        "Ese archivo ya existe; no se reemplazó nada.",
                    ));
                }
                if !dest.parent().is_some_and(Path::is_dir) {
                    return Err(err("The destination folder does not exist.", "La carpeta del destino no existe."));
                }
                let fields: Vec<(String, String)> = args
                    .get("campos")
                    .and_then(Value::as_object)
                    .map(|o| {
                        o.iter()
                            .take(200)
                            .map(|(k, v)| (k.clone(), v.as_str().map_or_else(|| v.to_string(), str::to_string)))
                            .collect()
                    })
                    .unwrap_or_default();
                let d = self.templates_dir()?;
                let text = templates::fill(&d, name, &fields, templates::today())
                    .map_err(|e| CallError::Tool(anyhow::anyhow!(e)))?;
                // `create_new`: si otro lo creó entre tanto, tampoco se reemplaza.
                use std::io::Write as _;
                let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&dest).map_err(|e| {
                    CallError::Tool(anyhow::anyhow!(format!(
                        "{} «{}» ({e}).",
                        pick("The file could not be created:", "No se pudo crear el archivo:"),
                        dest.display()
                    )))
                })?;
                f.write_all(text.as_bytes()).map_err(|e| CallError::Tool(anyhow::anyhow!(e.to_string())))?;
                Ok(Reply::Data(json!({ "documento": dest.display().to_string() })))
            }
            other => Err(CallError::Params(format!("herramienta desconocida: {other}"))),
        }
    }
}

fn format_schema() -> Value {
    json!({ "type": "string", "enum": ["pdf", "docx", "html"], "description": "pdf, docx (Word) o html (página autocontenida)" })
}

pub fn tool_list() -> Value {
    let write = json!({ "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false });
    json!([
        {
            "name": "exportar_documento",
            "title": "Exportar documento",
            "description": "Export a Markdown document (.md) to PDF, Word (.docx) or a self-contained web page (.html), with its images and diagrams. · Exporta un documento Markdown a PDF, Word o página web autocontenida, con sus imágenes y diagramas.",
            "inputSchema": { "type": "object", "properties": {
                "ruta": { "type": "string", "description": "Ruta absoluta del .md" },
                "formato": format_schema(),
                "destino": { "type": "string", "description": "Ruta absoluta del archivo exportado (por omisión, junto al .md con la extensión del formato). Si existe, se reemplaza." }
            }, "required": ["ruta", "formato"] },
            "annotations": write,
        },
        {
            "name": "convertir_markdown",
            "title": "Convertir Markdown",
            "description": "Convert Markdown text to PDF, Word or HTML and write it to a file. · Convierte un texto Markdown a PDF, Word o HTML y lo guarda en un archivo.",
            "inputSchema": { "type": "object", "properties": {
                "markdown": { "type": "string" },
                "formato": format_schema(),
                "destino": { "type": "string", "description": "Ruta absoluta del archivo (con la extensión del formato). Si existe, se reemplaza." }
            }, "required": ["markdown", "formato", "destino"] },
            "annotations": write,
        },
        {
            "name": "html_a_markdown",
            "title": "HTML a Markdown",
            "description": "Convert HTML (an email, a web page, a Word or Google Docs paste) to clean Markdown. Scripts and tracking images are dropped. · Convierte HTML a Markdown limpio (sin guiones ni imágenes de rastreo).",
            "inputSchema": { "type": "object", "properties": { "html": { "type": "string" } }, "required": ["html"] },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
        {
            "name": "listar_plantillas",
            "title": "Plantillas",
            "description": "List IureEditor's document templates (legal brief, contract, meeting minutes and the user's own). · Lista las plantillas de documento de IureEditor.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
        {
            "name": "crear_desde_plantilla",
            "title": "Crear desde plantilla",
            "description": "Create a new .md document from a template. {{fecha}} becomes today's date; each key in campos replaces {{key}}. Never replaces an existing file. · Crea un documento nuevo desde una plantilla; nunca reemplaza un archivo.",
            "inputSchema": { "type": "object", "properties": {
                "plantilla": { "type": "string", "description": "Nombre, como lo da listar_plantillas" },
                "destino": { "type": "string", "description": "Ruta absoluta del .md nuevo" },
                "campos": { "type": "object", "additionalProperties": { "type": "string" } }
            }, "required": ["plantilla", "destino"] },
            "annotations": write,
        }
    ])
}

impl Handler for EditorMcp {
    fn info(&self) -> ServerInfo {
        ServerInfo {
            name: "iureditor",
            title: "IureEditor",
            version: env!("CARGO_PKG_VERSION"),
            instructions: "Document conversion without a window (IureEditor): export Markdown documents to PDF, Word or \
                HTML, convert HTML to Markdown, and create documents from templates (never overwrites). · Conversión de \
                documentos sin ventana (IureEditor): exporta Markdown a PDF, Word o HTML, convierte HTML a Markdown y \
                crea documentos desde plantillas (nunca reemplaza)."
                .into(),
        }
    }

    fn tools(&self) -> Value {
        tool_list()
    }

    fn call(&self, name: &str, args: &Value, _call: &Call) -> Result<Reply, CallError> {
        self.run(name, args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(r: Result<Reply, CallError>) -> Value {
        match r {
            Ok(Reply::Data(v)) => v,
            Ok(Reply::Raw(v)) => v,
            Err(CallError::Tool(e)) => panic!("herramienta: {e}"),
            Err(CallError::Params(m)) => panic!("parámetros: {m}"),
        }
    }

    fn fails(r: Result<Reply, CallError>) -> String {
        match r {
            Err(CallError::Tool(e)) => e.to_string(),
            Err(CallError::Params(m)) => m,
            Ok(_) => panic!("debía fallar"),
        }
    }

    #[test]
    fn tools_export_convert_and_templates() {
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let tmp = tempfile::tempdir().unwrap();
        let mcp = EditorMcp { templates: Some(tmp.path().join("plantillas")) };
        let names: Vec<String> =
            tool_list().as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names.len(), 5);
        let md = tmp.path().join("nota.md");
        std::fs::write(&md, "# Nota\n\nHola **mundo**.\n").unwrap();
        // Exportar junto al .md.
        let v = data(mcp.run("exportar_documento", &json!({"ruta": md, "formato": "pdf"})));
        assert_eq!(v["destino"], tmp.path().join("nota.pdf").display().to_string());
        assert!(std::fs::read(tmp.path().join("nota.pdf")).unwrap().starts_with(b"%PDF-"));
        // Reglas: extensión, ruta absoluta, no pisar el origen.
        assert!(
            fails(mcp.run(
                "exportar_documento",
                &json!({"ruta": md, "formato": "pdf", "destino": tmp.path().join("x.docx")})
            ))
            .contains(".pdf")
        );
        assert!(
            fails(mcp.run("exportar_documento", &json!({"ruta": "nota.md", "formato": "pdf"}))).contains("absoluta")
        );
        assert!(fails(mcp.run("exportar_documento", &json!({"ruta": md, "formato": "rtf"}))).contains("formato"));
        // Convertir texto.
        let out = tmp.path().join("t.html");
        data(mcp.run("convertir_markdown", &json!({"markdown": "*hola*", "formato": "html", "destino": out})));
        assert!(std::fs::read_to_string(&out).unwrap().contains("<em>hola</em>"));
        // HTML → Markdown.
        let v = data(mcp.run("html_a_markdown", &json!({"html": "<h1>T</h1><p>a <b>b</b></p><script>x</script>"})));
        assert_eq!(v["markdown"].as_str().unwrap().trim(), "# T\n\na **b**");
        // Plantillas.
        let v = data(mcp.run("listar_plantillas", &json!({})));
        assert_eq!(v["plantillas"].as_array().unwrap().len(), 3);
        let nuevo = tmp.path().join("acta.md");
        data(mcp.run("crear_desde_plantilla", &json!({"plantilla": "Acta de reunión", "destino": nuevo})));
        assert!(std::fs::read_to_string(&nuevo).unwrap().starts_with("---\ntitulo: Acta de reunión"));
        assert!(
            fails(mcp.run("crear_desde_plantilla", &json!({"plantilla": "Acta de reunión", "destino": nuevo})))
                .contains("ya existe")
        );
        assert!(
            fails(mcp.run("crear_desde_plantilla", &json!({"plantilla": "../x", "destino": tmp.path().join("y.md")})))
                .contains("plantilla")
        );
        assert!(matches!(mcp.run("borrar_todo", &json!({})), Err(CallError::Params(_))));
    }
}
