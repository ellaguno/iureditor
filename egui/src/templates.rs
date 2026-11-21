//! Plantillas de documento, las mismas que la versión Tauri: archivos `.md` en la carpeta
//! `plantillas` de los datos de IureEditor (`~/.local/share/com.ellaguno.iureditor/plantillas` en
//! Linux). Si no existe se crea con las tres de arranque. Al crear un documento, `{{fecha}}` es la
//! fecha del día en español, `{{date}}` en el idioma de la interfaz y `{{clave}}` lo que se pida.

use std::path::{Path, PathBuf};

use iurefficient_ui::lang::pick;

/// Plantillas que se listan como mucho.
const MAX_TEMPLATES: usize = 500;
/// Plantilla más grande que se lee.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

/// La carpeta de plantillas (`IUREDITOR_TEMPLATES_DIR` la cambia, para pruebas).
pub fn dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("IUREDITOR_TEMPLATES_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(d));
    }
    dirs::data_dir().map(|d| d.join("com.ellaguno.iureditor").join("plantillas"))
}

/// Las plantillas de arranque de antes (con `[corchetes]`, las de la 1.x): si una sigue tal cual, se
/// cambia por la nueva.
const OLD_STARTERS: [(&str, &str); 3] = [
    (
        "Escrito legal.md",
        "---\ntitulo: Escrito\nexpediente: 000/0000\nautor:\nfecha: {{fecha}}\n---\n\n# Escrito\n\n\
**C. JUEZ** — [órgano jurisdiccional]\n\n[Nombre], por mi propio derecho, señalando como domicilio para oír y \
recibir notificaciones el ubicado en [domicilio], ante usted comparezco y expongo:\n\n## Hechos\n\n\
1. Primer hecho.\n2. Segundo hecho.\n\n## Derecho\n\nSon aplicables los artículos [—].\n\n## Puntos petitorios\n\n\
**PRIMERO.** Tenerme por presentado en los términos de este escrito.\n\n\
**SEGUNDO.** Acordar de conformidad lo solicitado.\n\nProtesto lo necesario.\n\n[Lugar], a {{fecha}}.\n",
    ),
    (
        "Contrato.md",
        "---\ntitulo: Contrato\nexpediente:\nfecha: {{fecha}}\n---\n\n# Contrato de [objeto]\n\n\
Contrato que celebran por una parte **[Parte A]** y por la otra **[Parte B]**, al tenor de las siguientes \
declaraciones y cláusulas.\n\n## Declaraciones\n\n1. Declara **[Parte A]**…\n2. Declara **[Parte B]**…\n\n\
## Cláusulas\n\n**PRIMERA. Objeto.**\n\n**SEGUNDA. Contraprestación.**\n\n| Concepto | Monto | Plazo |\n\
|----------|-------|-------|\n|          |       |       |\n\n**TERCERA. Vigencia.**\n\n\
Leído el presente y enteradas las partes de su contenido y alcance, lo firman por duplicado en [lugar], a {{fecha}}.\n",
    ),
    (
        "Acta de reunión.md",
        "---\ntitulo: Acta de reunión\nfecha: {{fecha}}\n---\n\n# Acta de reunión — {{fecha}}\n\n**Asistentes:**\n\n-\n\n\
## Temas tratados\n\n1.\n\n## Acuerdos\n\n- [ ] Acuerdo 1 — responsable, fecha compromiso\n\n## Próxima reunión\n\n\
Fecha: — Lugar: —\n",
    ),
];

/// Plantillas de arranque: lo que hay que llenar va como `{{campo}}` (al crear el documento se pide).
const STARTERS: [(&str, &str); 3] = [
    (
        "Escrito legal.md",
        "---\ntitulo: Escrito\nexpediente: {{expediente}}\nautor: {{autor}}\nfecha: {{fecha}}\n---\n\n# Escrito\n\n\
**C. JUEZ** — {{órgano jurisdiccional}}\n\n{{nombre}}, por mi propio derecho, señalando como domicilio para oír \
y recibir notificaciones el ubicado en {{domicilio}}, ante usted comparezco y expongo:\n\n## Hechos\n\n\
1. Primer hecho.\n2. Segundo hecho.\n\n## Derecho\n\nSon aplicables los artículos {{artículos}}.\n\n\
## Puntos petitorios\n\n**PRIMERO.** Tenerme por presentado en los términos de este escrito.\n\n\
**SEGUNDO.** Acordar de conformidad lo solicitado.\n\nProtesto lo necesario.\n\n{{lugar}}, a {{fecha}}.\n",
    ),
    (
        "Contrato.md",
        "---\ntitulo: Contrato\nexpediente: {{expediente}}\nfecha: {{fecha}}\n---\n\n# Contrato de {{objeto}}\n\n\
Contrato que celebran por una parte **{{parte A}}** y por la otra **{{parte B}}**, al tenor de las siguientes \
declaraciones y cláusulas.\n\n## Declaraciones\n\n1. Declara **{{parte A}}**…\n2. Declara **{{parte B}}**…\n\n\
## Cláusulas\n\n**PRIMERA. Objeto.**\n\n**SEGUNDA. Contraprestación.**\n\n| Concepto | Monto | Plazo |\n\
|----------|-------|-------|\n|          |       |       |\n\n**TERCERA. Vigencia.**\n\n\
Leído el presente y enteradas las partes de su contenido y alcance, lo firman por duplicado en {{lugar}}, a \
{{fecha}}.\n",
    ),
    (
        "Acta de reunión.md",
        "---\ntitulo: Acta de reunión\nfecha: {{fecha}}\n---\n\n# Acta de reunión — {{fecha}}\n\n\
**Asistentes:** {{asistentes}}\n\n## Temas tratados\n\n1.\n\n## Acuerdos\n\n\
- [ ] Acuerdo 1 — responsable, fecha compromiso\n\n## Próxima reunión\n\n{{próxima reunión}}\n",
    ),
];

/// Crea la carpeta con las plantillas de arranque la primera vez. Si ya existe, cambia por la nueva
/// cada plantilla de arranque que siga igual a la de antes (las que el usuario cambió no se tocan).
pub fn ensure(dir: &Path) {
    if dir.exists() {
        for ((name, new), (_, old)) in STARTERS.iter().zip(OLD_STARTERS.iter()) {
            let p = dir.join(name);
            if std::fs::read_to_string(&p).ok().as_deref() == Some(*old) {
                let _ = std::fs::write(&p, new);
            }
        }
        return;
    }
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    for (name, text) in STARTERS {
        let _ = std::fs::write(dir.join(name), text);
    }
}

/// Nombres de las plantillas (sin `.md`), en orden.
pub fn list(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut v: Vec<String> = rd
        .flatten()
        .take(MAX_TEMPLATES * 4)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            let lower = n.to_lowercase();
            lower.ends_with(".md").then(|| n.get(..n.len().saturating_sub(3)).unwrap_or_default().to_string())
        })
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .take(MAX_TEMPLATES)
        .collect();
    v.sort_by_key(|n| n.to_lowercase());
    v
}

/// ¿Un nombre de plantilla que no sale de la carpeta?
fn safe_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.contains(['/', '\\', '\0']) && name != "." && name != ".."
}

/// Fecha larga: «18 de noviembre de 2026» o «November 18, 2026».
pub fn long_date(y: i32, m: u32, d: u32, spanish: bool) -> String {
    const ES: [&str; 12] = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ];
    const EN: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    let i = (m.clamp(1, 12) - 1) as usize;
    if spanish {
        format!("{d} de {} de {y}", ES.get(i).copied().unwrap_or("enero"))
    } else {
        format!("{} {d}, {y}", EN.get(i).copied().unwrap_or("January"))
    }
}

/// El texto de la plantilla `name` con `{{fecha}}`, `{{date}}` y los `campos` resueltos.
pub fn fill(dir: &Path, name: &str, fields: &[(String, String)], today: (i32, u32, u32)) -> Result<String, String> {
    let missing = || format!("{} «{name}».", pick("There is no template named", "No hay ninguna plantilla llamada"));
    if !safe_name(name) {
        return Err(missing());
    }
    let path = dir.join(format!("{name}.md"));
    let meta = std::fs::metadata(&path).map_err(|_| missing())?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err(missing());
    }
    let raw = std::fs::read_to_string(&path).map_err(|_| missing())?;
    let (y, m, d) = today;
    let mut out = raw
        .replace("{{fecha}}", &long_date(y, m, d, true))
        .replace("{{date}}", &long_date(y, m, d, pick("en", "es") == "es"));
    for (k, v) in fields.iter().take(200) {
        let k = k.trim();
        if k.is_empty() || k.len() > 100 || k.contains(['{', '}']) {
            continue;
        }
        out = out.replace(&format!("{{{{{k}}}}}"), v).replace(&format!("{{{{ {k} }}}}"), v);
    }
    Ok(out)
}

/// Hoy (fecha local).
pub fn today() -> (i32, u32, u32) {
    use chrono::Datelike;
    let n = chrono::Local::now().date_naive();
    (n.year(), n.month(), n.day())
}

/// Los campos `{{clave}}` de la plantilla `name` que hay que pedir (sin `fecha` ni `date`, que se
/// ponen solos), en el orden en que aparecen y sin repetir.
pub fn fields(dir: &Path, name: &str) -> Vec<String> {
    if !safe_name(name) {
        return Vec::new();
    }
    let path = dir.join(format!("{name}.md"));
    if std::fs::metadata(&path).map_or(true, |m| !m.is_file() || m.len() > MAX_BYTES) {
        return Vec::new();
    }
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    fields_in(&raw)
}

/// Los campos de un texto de plantilla (ver [`fields`]).
pub fn fields_in(raw: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = raw;
    while let Some(i) = rest.find("{{") {
        let after = rest.get(i + 2..).unwrap_or("");
        let Some(j) = after.find("}}") else { break };
        let k = after.get(..j).unwrap_or("").trim();
        if !k.is_empty()
            && k.len() <= 100
            && !k.contains(['{', '}', '\n'])
            && k != "fecha"
            && k != "date"
            && !out.iter().any(|x| x == k)
        {
            out.push(k.to_string());
            if out.len() >= 50 {
                break;
            }
        }
        rest = after.get(j + 2..).unwrap_or("");
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn starters_ask_for_fields_and_untouched_old_ones_are_upgraded() {
        for (name, text) in super::STARTERS {
            assert!(!super::fields_in(text).is_empty(), "{name} pide campos");
            assert!(!text.contains("[Nombre]") && !text.contains("[lugar]"), "{name} sin corchetes");
        }
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        std::fs::write(d.join("Contrato.md"), super::OLD_STARTERS[1].1).unwrap();
        std::fs::write(d.join("Escrito legal.md"), "mi escrito, cambiado").unwrap();
        super::ensure(d);
        assert_eq!(
            std::fs::read_to_string(d.join("Contrato.md")).unwrap(),
            super::STARTERS[1].1,
            "la de antes, al día"
        );
        assert_eq!(
            std::fs::read_to_string(d.join("Escrito legal.md")).unwrap(),
            "mi escrito, cambiado",
            "la cambiada, no"
        );
        assert!(!d.join("Acta de reunión.md").exists(), "no se crea la que se borró");
    }

    #[test]
    fn fields_are_found_once_and_in_order() {
        let t = "# {{cliente}}\n\nExpediente {{ expediente }} de {{cliente}}, a {{fecha}} ({{date}}). {{}} {{a\nb}}";
        assert_eq!(super::fields_in(t), ["cliente", "expediente"]);
        assert!(super::fields_in("sin campos").is_empty());
    }

    use super::*;

    #[test]
    fn starters_list_and_fill() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("plantillas");
        ensure(&dir);
        std::fs::write(dir.join("Carta.md"), "Estimado {{nombre}}:\n\n{{fecha}} — {{no}}\n").unwrap();
        std::fs::write(dir.join("notas.txt"), "x").unwrap();
        assert_eq!(list(&dir), ["Acta de reunión", "Carta", "Contrato", "Escrito legal"]);
        let t = fill(&dir, "Carta", &[("nombre".into(), "Lic. Pérez".into())], (2026, 11, 18)).unwrap();
        assert_eq!(t, "Estimado Lic. Pérez:\n\n18 de noviembre de 2026 — {{no}}\n");
        assert!(
            fill(&dir, "Acta de reunión", &[], (2026, 1, 2))
                .unwrap()
                .contains("# Acta de reunión — 2 de enero de 2026")
        );
        for bad in ["../x", "", "No existe", "a/b"] {
            assert!(fill(&dir, bad, &[], (2026, 1, 1)).is_err(), "{bad}");
        }
        // Ya existe: no se tocan las del usuario.
        std::fs::remove_file(dir.join("Contrato.md")).unwrap();
        ensure(&dir);
        assert!(!dir.join("Contrato.md").exists());
        assert_eq!(long_date(2026, 11, 18, false), "November 18, 2026");
    }
}
