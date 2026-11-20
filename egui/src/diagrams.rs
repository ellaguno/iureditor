//! Diagramas dibujados en su lugar dentro del editor: el mismo motor que IureDesk
//! (`iuredesk-html-view`: `mermaid-svg` y el dibujo de mapas mentales de la suite, pintados con
//! Blitz), con los colores del tema de IureEditor. Así una nota se ve igual en las dos apps.

use std::hash::{Hash, Hasher};

use iuredesk_html_view::diagram;
use iuredesk_html_view::diagram::{ColorRole, DiagramTheme};
use iuredesk_html_view::markdown::NoteStyle;
use iuredesk_html_view::mindmap::{self, Layout, Palette, RootSize, Shape};
use iurefficient_ui::lang::pick;

/// Dibuja bloques ```` ```mermaid ```` y mapas mentales (`> [!MINDMAP…]`).
pub struct Diagrams {
    style: NoteStyle,
    background: [u8; 3],
}

fn rgb(c: egui::Color32) -> [u8; 3] {
    [c.r(), c.g(), c.b()]
}

impl Diagrams {
    /// Con los colores y la letra del tema actual.
    pub fn new(ui: &egui::Ui) -> Self {
        let c = iurefficient_ui::theme::colors(ui);
        let style = NoteStyle {
            text: rgb(c.text),
            muted: rgb(c.text_muted),
            accent: rgb(c.accent),
            code_bg: rgb(c.surface_alt),
            border: rgb(c.separator),
            font_px: iurefficient_ui::theme::body_font(ui.ctx()).size + 1.0,
        };
        Diagrams { style, background: rgb(ui.visuals().panel_fill) }
    }
}

impl iure_doc_ui::DiagramRenderer for Diagrams {
    fn accepts(&self, block: &str) -> bool {
        diagram::is_diagram_block(block)
    }

    fn key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        format!("{:?}{:?}", self.style, self.background).hash(&mut h);
        h.finish()
    }

    fn render(&self, block: &str, scale: f32) -> Result<iure_doc_ui::DiagramImage, String> {
        // Los mapas sin distribución propia: a ambos lados del centro (la radial se ve caótica).
        let px = diagram::draw_block(block, &self.style, DEFAULT_LAYOUT, scale, self.background)
            .map_err(|e| pick(&e.en, &e.es).to_string())?;
        Ok(iure_doc_ui::DiagramImage {
            width: px.width as usize,
            height: px.height as usize,
            rgba: px.rgba,
            points: [px.points.0, px.points.1],
            // Cada nodo, pulsable: su número es su línea del bloque.
            hotspots: px.boxes.iter().map(|b| iure_doc_ui::Hotspot { id: b.line, rect: b.rect }).collect(),
        })
    }

    fn node_action(&self, block: &str, id: usize, action: iure_doc_ui::NodeAction) -> Option<(String, Option<usize>)> {
        mindmap::find(block).into_iter().next()?;
        node_edit(block, id, action)
    }

    /// Un mapa mental se ve con su lista (arriba, o a la izquierda con `right`), salvo «solo el
    /// mapa» (`map`), como la 1.x. Mermaid, en lugar del código.
    fn placement(&self, block: &str) -> iure_doc_ui::Placement {
        let Some(map) = mindmap::find(block).into_iter().next() else { return iure_doc_ui::Placement::Replace };
        if map.view == mindmap::View::MapOnly {
            iure_doc_ui::Placement::Replace
        } else if meta_words(block).iter().any(|w| w.eq_ignore_ascii_case("right")) {
            iure_doc_ui::Placement::Right
        } else {
            iure_doc_ui::Placement::Below
        }
    }

    fn menu(&self, ui: &mut egui::Ui, block: &str) -> Option<String> {
        export_items(ui, block, &self.style, self.background);
        if let Some(map) = mindmap::find(block).into_iter().next() {
            return map_menu(ui, block, map.options);
        }
        let code = diagram::mermaid_code(block)?;
        let mut opts = diagram::read_options(&code);
        let mut changed = false;
        if let Some(t) = choose(ui, pick("Theme", "Tema"), opts.theme, &DiagramTheme::ALL, theme_label) {
            opts.theme = t;
            changed = true;
        }
        ui.menu_button(pick("Colors", "Colores"), |ui| {
            for role in ColorRole::ALL {
                ui.menu_button(color_label(role), |ui| {
                    if let Some(c) = swatches(ui, opts.colors.get(role)) {
                        opts.colors.set(role, c);
                        changed = true;
                        ui.close();
                    }
                });
            }
        });
        if code.trim_start().starts_with("mindmap")
            && let Some(p) =
                choose(ui, pick("Branch colors", "Colores de las ramas"), opts.palette, &Palette::ALL, palette_label)
        {
            opts.palette = p;
            changed = true;
        }
        changed.then(|| fence_with(block, &diagram::set_options(&code, &opts)))
    }
}

/// Sangría (columnas tras `> `), marca y dónde empieza el texto (bytes) de un elemento de la lista
/// de un mapa en la línea `line`.
fn item_of(line: &str) -> Option<(usize, String, usize)> {
    let lead = line.len() - line.trim_start_matches([' ', '\t']).len();
    let rest = line.get(lead..)?.strip_prefix('>')?;
    let after_gt = lead + 1 + usize::from(rest.starts_with(' '));
    let body = line.get(after_gt..)?;
    let t = body.trim_start_matches(' ');
    let indent = body.len() - t.len();
    let marker: String = t.chars().take_while(|c| matches!(c, '-' | '*' | '+')).take(1).collect();
    if marker.is_empty() || !t.get(1..).is_some_and(|r| r.starts_with(' ')) {
        return None;
    }
    Some((indent, marker, after_gt + indent + 2))
}

/// Edita la lista de un mapa mental desde su dibujo: rama hija o hermana del nodo de la línea `id`
/// (después de sus ramas), borrarla con sus ramas, o ir a su texto. Devuelve el bloque y dónde
/// dejar el cursor (carácter del bloque).
fn node_edit(block: &str, id: usize, action: iure_doc_ui::NodeAction) -> Option<(String, Option<usize>)> {
    use iure_doc_ui::NodeAction;
    let mut lines: Vec<String> = block.split('\n').map(str::to_string).collect();
    let line = lines.get(id)?.clone();
    let char_at = |lines: &[String], l: usize, byte: usize| -> usize {
        lines.iter().take(l).map(|x| x.chars().count() + 1).sum::<usize>()
            + lines.get(l).and_then(|x| x.get(..byte.min(x.len()))).map_or(0, |p| p.chars().count())
    };
    // El nodo: el centro (línea del marcador) o un elemento de la lista.
    let me = if id == 0 { None } else { Some(item_of(&line)?) };
    // Fin de sus ramas: las líneas siguientes más sangradas (o, para el centro, toda la lista).
    let mut end = id + 1;
    while let Some(l) = lines.get(end) {
        let deeper = match (&me, item_of(l)) {
            (None, _) => l.trim_start().starts_with('>'),
            (Some((ind, _, _)), Some((i2, _, _))) => i2 > *ind,
            (Some(_), None) => {
                l.trim_start().starts_with('>') && !l.trim_start().trim_start_matches('>').trim().is_empty()
            }
        };
        if !deeper {
            break;
        }
        end += 1;
    }
    let new_label = pick("New branch", "Nueva rama");
    match action {
        NodeAction::Goto => {
            let at = me.as_ref().map_or_else(|| line.find(']').map_or(0, |b| b + 1), |m| m.2);
            Some((block.to_string(), Some(char_at(&lines, id, at))))
        }
        NodeAction::Delete => {
            me.as_ref()?;
            lines.drain(id..end);
            Some((lines.join("\n"), None))
        }
        NodeAction::AddChild | NodeAction::AddSibling => {
            let (indent, marker) = match (&me, action) {
                (None, _) => (0, "-".to_string()),
                (Some((i, m, _)), NodeAction::AddChild) => (i + 2, m.clone()),
                (Some((i, m, _)), _) => (*i, m.clone()),
            };
            let new = format!("> {}{marker} {new_label}", " ".repeat(indent));
            let at = new.len();
            lines.insert(end, new);
            let caret = char_at(&lines, end, at);
            Some((lines.join("\n"), Some(caret)))
        }
    }
}

/// «Exportar como PNG…» y «Exportar como SVG…» (como IureEditor 1.x): el diálogo de guardar y el
/// dibujo van en otro hilo.
fn export_items(ui: &mut egui::Ui, block: &str, style: &NoteStyle, bg: [u8; 3]) {
    for (png, label) in
        [(true, pick("Export as PNG…", "Exportar como PNG…")), (false, pick("Export as SVG…", "Exportar como SVG…"))]
    {
        if ui.button(label).clicked() {
            let (block, style) = (block.to_string(), style.clone());
            let name = if png { pick("diagram.png", "diagrama.png") } else { pick("diagram.svg", "diagrama.svg") };
            std::thread::spawn(move || {
                let ext = if png { "png" } else { "svg" };
                let Some(path) = rfd::FileDialog::new().set_file_name(name).add_filter(ext, &[ext]).save_file() else {
                    return;
                };
                let data = if png {
                    diagram::draw_block(&block, &style, DEFAULT_LAYOUT, 2.0, bg)
                        .ok()
                        .and_then(|p| diagram::encode_png(p.width, p.height, &p.rgba))
                } else {
                    diagram::block_svg(&block, &style, DEFAULT_LAYOUT).ok().map(String::into_bytes)
                };
                if let Some(d) = data {
                    let _ = std::fs::write(path, d);
                }
            });
            ui.close();
        }
    }
    ui.separator();
}

/// Las palabras del metadato de un mapa (`> [!MINDMAP|map right] …`).
fn meta_words(block: &str) -> Vec<String> {
    let line = block.lines().next().unwrap_or("");
    let Some(open) = line.find("[!") else { return Vec::new() };
    let Some(close) = line.get(open..).and_then(|l| l.find(']')) else { return Vec::new() };
    let inner = line.get(open + 2..open + close).unwrap_or("");
    inner.split_once('|').map(|(_, m)| m.split_whitespace().map(str::to_string).collect()).unwrap_or_default()
}

/// Cambia la vista de un mapa: `None` lista arriba; `Some("right")` a la izquierda; `Some("map")`
/// solo el mapa.
fn set_view(block: &str, view: Option<&str>) -> Option<String> {
    let line_end = block.find('\n').unwrap_or(block.len());
    let line = block.get(..line_end)?;
    let open = line.find("[!")? + 2;
    let close = open + line.get(open..)?.find(']')?;
    let inner = line.get(open..close)?;
    let (kind, meta) = inner.split_once('|').unwrap_or((inner, ""));
    let mut words: Vec<&str> = meta
        .split_whitespace()
        .filter(|w| !matches!(w.to_ascii_lowercase().as_str(), "map" | "right" | "below"))
        .collect();
    words.extend(view);
    let inner = if words.is_empty() { kind.to_string() } else { format!("{kind}|{}", words.join(" ")) };
    Some(format!("{}{inner}{}", line.get(..open)?, block.get(close..)?))
}

/// Las opciones de un mapa mental de cita (`> [!MINDMAP…]`).
fn map_menu(ui: &mut egui::Ui, block: &str, o: mindmap::MapOptions) -> Option<String> {
    let mut opts = o;
    let mut changed = false;
    let layouts: Vec<Option<Layout>> = std::iter::once(None).chain(Layout::ALL.map(Some)).collect();
    let label = |l: Option<Layout>| l.map_or(pick("Both sides (default)", "A ambos lados (omisión)"), layout_label);
    if let Some(l) = choose(ui, pick("Layout", "Distribución"), opts.layout, &layouts, label) {
        opts.layout = l;
        changed = true;
    }
    if let Some(sh) = choose(ui, pick("Node shape", "Forma de los nodos"), opts.shape, &Shape::ALL, shape_label) {
        opts.shape = sh;
        changed = true;
    }
    if let Some(r) = choose(ui, pick("Center size", "Tamaño del centro"), opts.root, &RootSize::ALL, root_label) {
        opts.root = r;
        changed = true;
    }
    if let Some(p) =
        choose(ui, pick("Branch colors", "Colores de las ramas"), opts.palette, &Palette::ALL, palette_label)
    {
        opts.palette = p;
        changed = true;
    }
    let words = meta_words(block);
    let has = |w: &str| words.iter().any(|x| x.eq_ignore_ascii_case(w));
    let current = if has("map") {
        2
    } else if has("right") {
        1
    } else {
        0
    };
    let views = [
        (0, pick("List above, map below", "Lista arriba, mapa debajo"), None),
        (1, pick("List on the left, map on the right", "Lista a la izquierda, mapa a la derecha"), Some("right")),
        (2, pick("Map only (hides the list)", "Solo el mapa (oculta la lista)"), Some("map")),
    ];
    let mut view: Option<Option<&str>> = None;
    ui.menu_button(pick("View", "Vista"), |ui| {
        for (k, l, v) in views {
            if ui.selectable_label(k == current, l).clicked() {
                view = Some(v);
                ui.close();
            }
        }
    });
    let mut out = changed.then(|| mindmap::set_options(block, 0, &opts)).flatten();
    if let Some(v) = view {
        out = set_view(out.as_deref().unwrap_or(block), v);
    }
    out
}

/// El bloque con otro código Mermaid (la misma cerca).
fn fence_with(block: &str, code: &str) -> String {
    let t = block.trim_start();
    let fence: String = t.chars().take_while(|c| *c == '`' || *c == '~').collect();
    let fence = if fence.len() < 3 { "```".to_string() } else { fence };
    format!("{fence}mermaid\n{}\n{fence}", code.trim_end())
}

/// Un submenú con las opciones y la actual marcada.
fn choose<T: Copy + PartialEq>(
    ui: &mut egui::Ui,
    title: &str,
    current: T,
    all: &[T],
    label: impl Fn(T) -> &'static str,
) -> Option<T> {
    let mut picked = None;
    ui.menu_button(format!("{title}: {}", label(current)), |ui| {
        for &o in all {
            if ui.selectable_label(o == current, label(o)).clicked() {
                picked = Some(o);
                ui.close();
            }
        }
    });
    picked
}

/// Muestras de color para elegir (`Some(None)`: el del tema).
fn swatches(ui: &mut egui::Ui, current: Option<[u8; 3]>) -> Option<Option<[u8; 3]>> {
    const COLORS: [[u8; 3]; 12] = [
        [0x1d, 0x4e, 0xd8],
        [0x0f, 0x76, 0x6e],
        [0x15, 0x80, 0x3d],
        [0xb4, 0x53, 0x09],
        [0xb9, 0x1c, 0x1c],
        [0x6d, 0x28, 0xd9],
        [0xbf, 0xdb, 0xfe],
        [0xbb, 0xf7, 0xd0],
        [0xfe, 0xd7, 0xaa],
        [0xe9, 0xd5, 0xff],
        [0xfe, 0xca, 0xca],
        [0xf3, 0xf4, 0xf6],
    ];
    let mut out = None;
    egui::Grid::new("muestras").spacing(egui::vec2(3.0, 3.0)).show(ui, |ui| {
        for (k, c) in COLORS.iter().enumerate() {
            let (r, resp) = ui.allocate_exact_size(egui::vec2(20.0, 20.0), egui::Sense::click());
            ui.painter().rect_filled(r, 3.0, egui::Color32::from_rgb(c[0], c[1], c[2]));
            if current == Some(*c) {
                ui.painter().rect_stroke(
                    r,
                    3.0,
                    egui::Stroke::new(2.0, ui.visuals().strong_text_color()),
                    egui::StrokeKind::Outside,
                );
            }
            if resp.clicked() {
                out = Some(Some(*c));
            }
            if k % 6 == 5 {
                ui.end_row();
            }
        }
    });
    if ui.button(pick("As the theme", "Como el tema")).clicked() {
        out = Some(None);
    }
    out
}

/// Distribución de un mapa mental que no dice la suya (decisión del dueño 2026-11-20).
const DEFAULT_LAYOUT: Layout = Layout::Balanced;

fn layout_label(l: Layout) -> &'static str {
    match l {
        Layout::Right => pick("To the right", "Hacia la derecha"),
        Layout::Radial => pick("Radial", "Radial"),
        Layout::Balanced => pick("Both sides", "A ambos lados"),
        Layout::Down => pick("Top to bottom", "De arriba abajo"),
    }
}

fn shape_label(s: Shape) -> &'static str {
    match s {
        Shape::Default => pick("Pill (default)", "Píldora (omisión)"),
        Shape::Square => pick("Square", "Cuadrado"),
        Shape::Rounded => pick("Rounded", "Redondeado"),
        Shape::Circle => pick("Circle", "Círculo"),
        Shape::Cloud => pick("Cloud", "Nube"),
        Shape::Bang => pick("Burst", "Explosión"),
        Shape::Hexagon => pick("Hexagon", "Hexágono"),
    }
}

fn root_label(r: RootSize) -> &'static str {
    match r {
        RootSize::Auto => pick("Automatic", "Automático"),
        RootSize::Small => pick("Small", "Chico"),
        RootSize::Medium => pick("Medium", "Mediano"),
        RootSize::Large => pick("Large", "Grande"),
    }
}

fn palette_label(p: Palette) -> &'static str {
    match p {
        Palette::Iure => pick("Like the app", "Como la app"),
        Palette::Pastel => pick("Pastel", "Pastel"),
        Palette::Warm => pick("Warm", "Cálida"),
        Palette::Cool => pick("Cool", "Fría"),
        Palette::Mono => pick("Grays", "Grises"),
    }
}

fn theme_label(t: DiagramTheme) -> &'static str {
    match t {
        DiagramTheme::App => pick("Like the app", "Como la app"),
        DiagramTheme::Default => pick("Classic Mermaid", "Mermaid clásico"),
        DiagramTheme::Neutral => pick("Neutral", "Neutro"),
        DiagramTheme::Forest => pick("Forest", "Bosque"),
        DiagramTheme::Dark => pick("Dark", "Oscuro"),
        DiagramTheme::Base => pick("Warm", "Cálido"),
    }
}

fn color_label(r: ColorRole) -> &'static str {
    match r {
        ColorRole::NodeFill => pick("Node fill", "Relleno de los nodos"),
        ColorRole::NodeBorder => pick("Node border", "Borde de los nodos"),
        ColorRole::Text => pick("Text", "Texto"),
        ColorRole::Line => pick("Lines and arrows", "Líneas y flechas"),
        ColorRole::GroupFill => pick("Groups", "Grupos"),
        ColorRole::NoteFill => pick("Notes", "Notas"),
    }
}

/// Fórmulas en bloque (`$$…$$`), dibujadas con Typst (`iure-doc-export`, la misma conversión que el
/// PDF). Si Typst no entiende la fórmula, se ve el LaTeX con el error debajo.
pub struct Formulas {
    color: [u8; 3],
    size_pt: f32,
    /// En línea (`$…$`, dentro de un párrafo) en vez de en bloque.
    inline: bool,
}

impl Formulas {
    pub fn new(ui: &egui::Ui, zoom: f32) -> Self {
        let c = iurefficient_ui::theme::colors(ui);
        let body = iurefficient_ui::theme::body_font(ui.ctx()).size;
        Formulas { color: rgb(c.text), size_pt: body * zoom.clamp(0.5, 3.0) * 1.1, inline: false }
    }

    /// Para las fórmulas en línea: a la altura de la letra del texto.
    pub fn inline(ui: &egui::Ui, zoom: f32) -> Self {
        let mut f = Self::new(ui, zoom);
        f.size_pt /= 1.1;
        f.inline = true;
        f
    }
}

impl iure_doc_ui::DiagramRenderer for Formulas {
    fn accepts(&self, block: &str) -> bool {
        if self.inline {
            let t = block.trim();
            t.len() > 2 && t.starts_with('$') && t.ends_with('$') && !t.starts_with("$$")
        } else {
            iure_doc::math::display_math(block).is_some()
        }
    }

    fn key(&self) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        format!("{:?}{}{}", self.color, self.size_pt, self.inline).hash(&mut h);
        h.finish()
    }

    fn render(&self, block: &str, scale: f32) -> Result<iure_doc_ui::DiagramImage, String> {
        let latex = if self.inline {
            block.trim().trim_matches('$')
        } else {
            iure_doc::math::display_math(block).unwrap_or_default()
        };
        let img = iure_doc_export::math::render_math(latex, !self.inline, self.size_pt, self.color, scale)
            .map_err(|e| pick(&e.en, &e.es).to_string())?;
        Ok(iure_doc_ui::DiagramImage {
            width: img.width as usize,
            height: img.height as usize,
            rgba: img.rgba,
            points: [img.points.0, img.points.1],
            hotspots: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mind_map_views_and_options_are_written_in_the_marker() {
        let b = "> [!MINDMAP] Centro\n> - Uno\n> - Dos";
        assert_eq!(set_view(b, Some("right")).as_deref(), Some("> [!MINDMAP|right] Centro\n> - Uno\n> - Dos"));
        let r = set_view("> [!MINDMAP|right square] C\n> - a", Some("map")).unwrap();
        assert_eq!(r, "> [!MINDMAP|square map] C\n> - a");
        assert_eq!(set_view(&r, None).as_deref(), Some("> [!MINDMAP|square] C\n> - a"));
        let o = mindmap::MapOptions { layout: Some(Layout::Balanced), palette: Palette::Pastel, ..Default::default() };
        let w = mindmap::set_options(b, 0, &o).unwrap();
        assert!(w.contains("layout-both") && w.contains("palette-pastel"), "{w}");
        assert_eq!(fence_with("~~~mermaid\nx\n~~~", "pie\n"), "~~~mermaid\npie\n~~~");
    }

    #[test]
    fn nodes_are_edited_from_the_drawing() {
        use iure_doc_ui::NodeAction as A;
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let b = "> [!MINDMAP] C\n> - Uno\n>   - Uno.a\n> - Dos";
        // Hija de «Uno»: después de sus ramas, más sangrada; el cursor al final.
        let (t, c) = node_edit(b, 1, A::AddChild).unwrap();
        assert_eq!(t, "> [!MINDMAP] C\n> - Uno\n>   - Uno.a\n>   - Nueva rama\n> - Dos");
        assert_eq!(c, Some(t.find("Nueva rama").map(|i| t[..i].chars().count() + 10).unwrap()));
        // Hermana de «Uno»: después de todo su subárbol, misma sangría.
        let (t, _) = node_edit(b, 1, A::AddSibling).unwrap();
        assert_eq!(t, "> [!MINDMAP] C\n> - Uno\n>   - Uno.a\n> - Nueva rama\n> - Dos");
        // Del centro: rama de primer nivel al final.
        let (t, _) = node_edit(b, 0, A::AddChild).unwrap();
        assert!(t.ends_with("> - Dos\n> - Nueva rama"), "{t}");
        // Borrar «Uno» se lleva sus ramas; el centro no se borra.
        assert_eq!(node_edit(b, 1, A::Delete).map(|x| x.0).as_deref(), Some("> [!MINDMAP] C\n> - Dos"));
        assert_eq!(node_edit(b, 0, A::Delete), None);
        // Ir al texto de «Dos».
        assert_eq!(node_edit(b, 3, A::Goto).and_then(|x| x.1), Some(b.find("Dos").unwrap()));
    }
}
