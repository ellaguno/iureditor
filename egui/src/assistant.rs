//! Pestaña **Asistente** del panel lateral, como IureEditor 1.x: la IA de la instancia de
//! Iurefficient del usuario (su chat), sobre el **proyecto** del documento (busca en sus documentos
//! y cita las fuentes) o en el **chat general**. La respuesta llega según se escribe; se inserta en
//! el documento, reemplaza la selección o se copia. Con contexto: la selección o el documento
//! completo; «Analizar el documento» trae las revisiones de la 1.x.
//!
//! Habla por el hilo de red de [`crate::iure`] (la misma sesión); sin conexión, invita a conectar.

use std::path::Path;

use egui::{RichText, Ui};
use iurefficient_connect::chat::Reference;
use iurefficient_ui::icons::{self, Icon};
use iurefficient_ui::{pick, theme};

use crate::iure::{IurePanel, Rep, Req};

/// Documento más largo que se manda completo (caracteres).
const MAX_DOC: usize = 60_000;
/// Mensajes que se guardan en la conversación visible.
const MAX_MSGS: usize = 200;

#[derive(Clone, Debug)]
struct Msg {
    user: bool,
    text: String,
    refs: Vec<Reference>,
    /// Se mandó con el documento completo (sus palabras).
    doc_words: Option<usize>,
    error: bool,
}

/// El documento para dar contexto: nombre, texto y lo seleccionado.
pub(crate) struct DocCtx<'a> {
    pub name: &'a str,
    pub text: &'a str,
    pub selection: Option<&'a str>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Context {
    #[default]
    None,
    Selection,
    Document,
}

/// Lo que pide la pestaña a la app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AssistAct {
    Insert(String),
    Replace(String),
    /// Ir a la pestaña Iurefficient para conectar.
    Connect,
}

#[derive(Default)]
pub(crate) struct Assistant {
    msgs: Vec<Msg>,
    pub input: String,
    /// Preguntar en el chat general aunque el documento sea de un proyecto.
    global: bool,
    /// Conversación abierta: (proyecto, id).
    conversation: Option<(Option<String>, String)>,
    /// Petición en curso.
    pending: Option<u64>,
    next_id: u64,
    pub context: Context,
    notice: Option<String>,
    copied: Option<usize>,
}

/// Las viñetas de lista como `•` (la vista de solo lectura no dibuja las de bloque).
fn bulleted(s: &str) -> String {
    s.lines()
        .map(|l| {
            let t = l.trim_start();
            let indent = l.get(..l.len() - t.len()).unwrap_or("");
            match t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
                Some(rest) if !rest.starts_with("[ ]") && !rest.starts_with("[x]") => format!("{indent}• {rest}"),
                _ => l.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Sin las marcas de cita (`[1]`, `[2]`…), para insertar en el documento.
pub(crate) fn strip_citations(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let rest: String = chars.clone().take_while(|d| *d != ']').take(4).collect();
            if !rest.is_empty()
                && rest.chars().all(|d| d.is_ascii_digit())
                && chars.clone().nth(rest.len()) == Some(']')
            {
                for _ in 0..=rest.len() {
                    chars.next();
                }
                // Sin el espacio que dejaba antes la cita.
                if out.ends_with(' ') && chars.peek().is_some_and(|n| matches!(n, '.' | ',' | ';' | ':' | ' ')) {
                    out.pop();
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

impl Assistant {
    /// Una conversación de ejemplo (capturas).
    #[cfg(test)]
    pub(crate) fn demo(&mut self) {
        self.msgs = vec![
            Msg {
                user: true,
                text: "Redacta una cláusula de confidencialidad breve".into(),
                refs: Vec::new(),
                doc_words: None,
                error: false,
            },
            Msg {
                user: false,
                text: "**Confidencialidad.** Las partes guardarán reserva sobre la información que reciban con motivo de este contrato y no la revelarán a terceros sin consentimiento por escrito, salvo mandato de autoridad [1].".into(),
                refs: vec![Reference {
                    index: 1,
                    kind: "document".into(),
                    title: "Contrato de arrendamiento".into(),
                    excerpt: "Cláusula décima: confidencialidad…".into(),
                    entity_id: None,
                }],
                doc_words: None,
                error: false,
            },
        ];
    }

    fn reset(&mut self) {
        self.msgs.clear();
        self.conversation = None;
        self.pending = None;
        self.notice = None;
    }

    /// Manda `question`, con el contexto elegido (o el documento entero si `whole`).
    fn send(
        &mut self,
        iure: &mut IurePanel,
        case: Option<&(String, String)>,
        question: &str,
        whole: bool,
        doc: &DocCtx<'_>,
    ) {
        let (doc_name, text, selection) = (doc.name, doc.text, doc.selection);
        let q = question.trim();
        if q.is_empty() || self.pending.is_some() {
            return;
        }
        let ctx = if whole { Context::Document } else { self.context };
        let mut message = q.to_string();
        let mut doc_words = None;
        match ctx {
            Context::None => {}
            Context::Selection => {
                if let Some(sel) = selection.filter(|s| !s.trim().is_empty()) {
                    message = format!("{q}\n\n---\n{}:\n\n{sel}", pick("Selected text", "Texto seleccionado"));
                }
            }
            Context::Document => {
                if text.trim().is_empty() {
                    self.notice = Some(pick("The document is empty.", "El documento está vacío.").into());
                    return;
                }
                let n = text.chars().count();
                if n > MAX_DOC {
                    self.notice = Some(format!(
                        "{} ({n} {}; {MAX_DOC} {}). {}",
                        pick(
                            "The document is too long to send whole",
                            "El documento es demasiado largo para mandarlo completo"
                        ),
                        pick("characters", "caracteres"),
                        pick("at most", "como máximo"),
                        pick("Select the part you want to analyze.", "Selecciona la parte que quieras analizar.")
                    ));
                    return;
                }
                // Conversación nueva con el documento (el asistente ya no ve las preguntas anteriores).
                if self.conversation.is_some() {
                    self.conversation = None;
                    self.notice = Some(
                        pick(
                            "New conversation with the document: the assistant no longer sees the previous questions.",
                            "Conversación nueva con el documento: el asistente ya no ve las preguntas anteriores.",
                        )
                        .into(),
                    );
                }
                doc_words = Some(text.split_whitespace().count());
                message = format!("{q}\n\n---\n{} «{doc_name}»:\n\n{text}", pick("Document", "Documento"));
            }
        }
        let case_id = case.filter(|_| !self.global).map(|c| c.0.clone());
        // Otra conversación si cambió el proyecto.
        if self.conversation.as_ref().is_some_and(|(c, _)| *c != case_id) {
            self.conversation = None;
        }
        self.next_id = self.next_id.wrapping_add(1);
        let id = self.next_id;
        let sent = iure.ask(Req::Ask {
            id,
            case_id: case_id.clone(),
            conversation: self.conversation.as_ref().map(|c| c.1.clone()),
            title: format!("iureditor · {doc_name}"),
            message,
            system: Some(
                pick(
                    "You help write documents in IureEditor. Answer in Markdown, ready to paste into the document.",
                    "Ayudas a redactar documentos en IureEditor. Responde en Markdown, listo para pegar en el documento.",
                )
                .into(),
            ),
        });
        if !sent {
            self.notice = Some(pick("Not connected to Iurefficient.", "Sin conexión con Iurefficient.").into());
            return;
        }
        if self.conversation.is_none() {
            // Se recuerda el proyecto; el id llega con la respuesta.
            self.conversation = Some((case_id, String::new()));
        }
        self.msgs.push(Msg { user: true, text: q.into(), refs: Vec::new(), doc_words, error: false });
        self.msgs.push(Msg { user: false, text: String::new(), refs: Vec::new(), doc_words: None, error: false });
        if self.msgs.len() > MAX_MSGS {
            self.msgs.drain(..self.msgs.len() - MAX_MSGS);
        }
        self.pending = Some(id);
        self.input.clear();
    }

    /// Recoge lo que llegó del hilo de red.
    fn poll(&mut self, iure: &mut IurePanel) {
        for r in iure.take_chat() {
            match r {
                Rep::Token { id, so_far } if Some(id) == self.pending => {
                    if let Some(m) = self.msgs.last_mut() {
                        m.text = so_far;
                    }
                }
                Rep::Answer { id, conversation, answer } if Some(id) == self.pending => {
                    self.pending = None;
                    if let Some(c) = self.conversation.as_mut() {
                        c.1 = conversation;
                    }
                    if let Some(m) = self.msgs.last_mut() {
                        m.text = answer.content;
                        m.refs = answer.references;
                    }
                }
                Rep::AskFailed { id, error } if Some(id) == self.pending => {
                    self.pending = None;
                    // Sin conversación válida: la siguiente abre otra.
                    if self.conversation.as_ref().is_some_and(|c| c.1.is_empty()) {
                        self.conversation = None;
                    }
                    if let Some(m) = self.msgs.last_mut() {
                        m.text = error;
                        m.error = true;
                    }
                }
                _ => {}
            }
        }
    }

    /// La pestaña. `doc`: el documento activo; `text`, su texto; `selection`, lo seleccionado.
    pub(crate) fn show(
        &mut self,
        ui: &mut Ui,
        iure: &mut IurePanel,
        doc: Option<&Path>,
        text: &str,
        selection: Option<&str>,
    ) -> Option<AssistAct> {
        let c = theme::colors(ui);
        let mut act = None;
        self.poll(iure);
        if self.pending.is_some() {
            ui.ctx().request_repaint_after(std::time::Duration::from_millis(200));
        }
        if !iure.ready() {
            ui.add_space(8.0);
            ui.label(
                RichText::new(pick(
                    "The assistant uses the AI of your Iurefficient instance. Connect your account to use it.",
                    "El asistente usa la IA de tu instancia de Iurefficient. Conecta tu cuenta para usarlo.",
                ))
                .color(c.text_muted),
            );
            if ui.button(pick("Connect to Iurefficient", "Conectar con Iurefficient")).clicked() {
                act = Some(AssistAct::Connect);
            }
            return act;
        }
        let case = iure.case_of(doc);
        let word = iure.case_word();
        let in_case = case.is_some() && !self.global;
        let doc_name = doc
            .and_then(Path::file_stem)
            .map_or_else(|| pick("untitled", "sin título").to_string(), |n| n.to_string_lossy().into_owned());
        // Arriba: ámbito, analizar y conversación nueva.
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 4.0;
            if let Some((_, title)) = &case {
                let mut cap = word.clone();
                if let Some(f) = cap.get(..1) {
                    cap = format!("{}{}", f.to_uppercase(), cap.get(1..).unwrap_or(""));
                }
                if ui.selectable_label(!self.global, cap).on_hover_text(title).clicked() && self.global {
                    self.global = false;
                    self.reset();
                }
            }
            let g =
                ui.selectable_label(case.is_none() || self.global, pick("General chat", "Chat general")).on_hover_text(
                    pick("Without searching the project documents", "Sin buscar en los documentos del proyecto"),
                );
            if g.clicked() && case.is_some() && !self.global {
                self.global = true;
                self.reset();
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if icons::icon_button(ui, Icon::Plus, pick("New conversation", "Nueva conversación"), true).clicked() {
                    self.reset();
                }
            });
        });
        let mut analyses = vec![
            (
                pick("Review: inconsistencies and errors", "Revisar: inconsistencias y errores"),
                pick(
                    "Review the document. Point out inconsistencies, contradictions, wording errors, wrong cross-references (to clauses, sections or annexes) and data that do not match. For each finding, quote the passage briefly and propose the correction. If there is nothing relevant, say so.",
                    "Revisa el documento. Señala inconsistencias, contradicciones, errores de redacción, remisiones equivocadas (a cláusulas, apartados o anexos) y datos que no cuadren entre sí. En cada hallazgo cita brevemente el pasaje y propone la corrección. Si no hay nada relevante, dilo.",
                ),
            ),
            (
                pick("Summary and key points", "Resumen y puntos clave"),
                pick(
                    "Summarize the document in one paragraph and then list its key points (parties, obligations, dates, amounts, deadlines) as a list.",
                    "Resume el documento en un párrafo y después lista sus puntos clave (partes, obligaciones, fechas, montos, plazos) como lista.",
                ),
            ),
            (
                pick("What is missing?", "¿Qué le falta?"),
                pick(
                    "According to the type of document, point out what is missing: sections, data, dates, signatures, clauses or annexes it should normally include. Order them by importance.",
                    "Según el tipo de documento, señala lo que le falta: apartados, datos, fechas, firmas, cláusulas o anexos que normalmente debería incluir. Ordénalos por importancia.",
                ),
            ),
        ];
        if in_case {
            analyses.push((
                pick("Compare with the project", "Contrastar con el proyecto"),
                pick(
                    "Compare the document with the project information. Point out data that do not match the project documents (names, dates, amounts, numbers, facts) and relevant project facts the document does not mention. Cite the sources.",
                    "Compara el documento con la información del proyecto. Señala los datos que no coincidan con los documentos del proyecto (nombres, fechas, montos, números, hechos) y los hechos relevantes del proyecto que el documento no menciona. Cita las fuentes.",
                ),
            ));
        }
        let mut analyze: Option<String> = None;
        ui.menu_button(pick("Analyze the document", "Analizar el documento"), |ui| {
            for (label, prompt) in &analyses {
                if ui.button(*label).clicked() {
                    analyze = Some((*prompt).to_string());
                    ui.close();
                }
            }
        });
        if let Some(p) = analyze {
            self.send(iure, case.as_ref(), &p, true, &DocCtx { name: &doc_name, text, selection });
        }
        ui.separator();
        // Abajo: contexto, pregunta y aviso de privacidad.
        let mut ask: Option<String> = None;
        egui::Panel::bottom("iureditor-assistant-input")
            .frame(egui::Frame::new().inner_margin(egui::Margin::symmetric(0, 4)))
            .resizable(false)
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let sel_n = selection.map_or(0, |s| s.chars().count());
                    for (k, label, tip) in [
                        (Context::None, pick("No context", "Sin contexto"), String::new()),
                        (
                            Context::Selection,
                            pick("Selection", "Selección"),
                            format!(
                                "{} ({sel_n} {})",
                                pick("Send the selected text with the question", "Mandar el texto seleccionado con la pregunta"),
                                pick("characters", "caracteres")
                            ),
                        ),
                        (
                            Context::Document,
                            pick("Document", "Documento"),
                            pick("Send the whole document with the question", "Mandar el documento completo con la pregunta").into(),
                        ),
                    ] {
                        let r = ui.selectable_label(self.context == k, RichText::new(label).small());
                        let r = if tip.is_empty() { r } else { r.on_hover_text(tip) };
                        if r.clicked() {
                            self.context = k;
                        }
                    }
                });
                let hint = if in_case {
                    pick("Ask about the project…", "Pregunta sobre el proyecto…")
                } else {
                    pick("Ask something for your document…", "Pregunta algo para tu documento…")
                };
                let field = ui.add(
                    egui::TextEdit::multiline(&mut self.input)
                        .hint_text(hint)
                        .desired_rows(2)
                        .desired_width(f32::INFINITY)
                        .return_key(Some(egui::KeyboardShortcut::new(egui::Modifiers::SHIFT, egui::Key::Enter))),
                );
                field.widget_info(|| egui::WidgetInfo::labeled(egui::Role::MultilineTextInput, true, hint));
                let enter = field.has_focus()
                    && ui.input_mut(|i| i.consume_key(egui::Modifiers::NONE, egui::Key::Enter));
                ui.horizontal(|ui| {
                    if self.pending.is_some() {
                        ui.add(egui::Spinner::new().size(12.0));
                        let writing = self.msgs.last().is_some_and(|m| !m.text.is_empty());
                        ui.label(
                            RichText::new(if writing { pick("Writing…", "Escribiendo…") } else { pick("Thinking…", "Pensando…") })
                                .small()
                                .color(c.text_muted),
                        );
                        if ui.small_button(pick("Cancel", "Cancelar")).clicked() {
                            self.pending = None;
                            if let Some(m) = self.msgs.last_mut()
                                && m.text.is_empty()
                            {
                                m.text = pick("Cancelled.", "Cancelado.").into();
                                m.error = true;
                            }
                        }
                    } else {
                        let send = ui
                            .add_enabled(
                                !self.input.trim().is_empty(),
                                egui::Button::new(RichText::new(pick("Send", "Enviar")).color(c.on_accent)).fill(c.accent),
                            )
                            .on_hover_text(pick("Send (Enter)", "Enviar (Intro)"));
                        if send.clicked() || enter {
                            ask = Some(self.input.clone());
                        }
                    }
                });
                ui.label(
                    RichText::new(pick(
                        "The question and the chosen context (selection or whole document) are sent to your Iurefficient instance. Each question uses AI quota.",
                        "Se envía a tu instancia de Iurefficient la pregunta y el contexto elegido (selección o documento completo). Cada pregunta gasta cuota de IA.",
                    ))
                    .small()
                    .color(c.text_muted),
                );
            });
        if let Some(q) = ask {
            self.send(iure, case.as_ref(), &q, false, &DocCtx { name: &doc_name, text, selection });
        }
        if let Some(n) = &self.notice {
            ui.label(RichText::new(n).small().color(c.warning));
        }
        // La conversación.
        egui::ScrollArea::vertical().id_salt("side-assistant").stick_to_bottom(true).show(ui, |ui| {
            if self.msgs.is_empty() {
                ui.label(
                    RichText::new(if in_case {
                        pick(
                            "Ask about the project: the assistant searches its documents and cites its sources.",
                            "Pregunta sobre el proyecto: el asistente busca en sus documentos y cita sus fuentes.",
                        )
                    } else {
                        pick(
                            "Ask for a text, a fact or an idea for your document.",
                            "Pide un texto, un dato o una idea para tu documento.",
                        )
                    })
                    .color(c.text_muted),
                );
                let suggestions: Vec<&str> = if in_case {
                    vec![
                        pick(
                            "What is the file number and who are the parties?",
                            "¿Cuál es el número de expediente y quiénes son las partes?",
                        ),
                        pick(
                            "Summarize the main facts in one paragraph",
                            "Resume los hechos principales en un párrafo",
                        ),
                        pick("Which deadlines are coming up?", "¿Qué plazos vencen próximamente?"),
                    ]
                } else {
                    vec![
                        pick("Draft a confidentiality clause", "Redacta una cláusula de confidencialidad"),
                        pick("Suggest a structure for this document", "Sugiere una estructura para este documento"),
                    ]
                };
                if case.is_none() {
                    ui.label(
                        RichText::new(format!(
                            "{} {word} {}",
                            pick("To ask about the documents of a", "Para preguntar sobre los documentos de un"),
                            pick(
                                ", open or save this document in it from the Iurefficient tab.",
                                ", abre o guarda este documento en él desde la pestaña Iurefficient."
                            )
                        ))
                        .small()
                        .color(c.text_muted),
                    );
                }
                for s in suggestions {
                    if ui.link(s).clicked() {
                        self.input = s.to_string();
                    }
                }
            }
            let last = self.msgs.len().saturating_sub(1);
            for (k, m) in self.msgs.iter().enumerate() {
                ui.add_space(6.0);
                if m.user {
                    egui::Frame::new().fill(c.surface_alt).corner_radius(6.0).inner_margin(egui::Margin::same(6)).show(
                        ui,
                        |ui| {
                            ui.label(RichText::new(&m.text).color(c.text));
                            if let Some(w) = m.doc_words {
                                ui.label(
                                    RichText::new(format!(
                                        "{} · {w} {}",
                                        pick("Whole document", "Documento completo"),
                                        pick("words", "palabras")
                                    ))
                                    .small()
                                    .color(c.text_muted),
                                );
                            }
                        },
                    );
                    continue;
                }
                let ink = if m.error { ui.visuals().error_fg_color } else { c.text };
                if m.text.is_empty() {
                    continue;
                }
                if m.error {
                    ui.label(RichText::new(&m.text).color(ink));
                } else {
                    // Con el estilo del editor (negritas, títulos, enlaces), sin las marcas.
                    let style = iure_doc_ui::EditorStyle::from_ui(ui);
                    let job = iure_doc_ui::layout_job(&bulleted(&m.text), &style, ui.available_width(), None);
                    ui.label(job);
                }
                if !m.refs.is_empty() {
                    egui::CollapsingHeader::new(format!("{} ({})", pick("Sources", "Fuentes"), m.refs.len()))
                        .id_salt(("fuentes", k))
                        .show(ui, |ui| {
                            for r in &m.refs {
                                ui.label(RichText::new(format!("[{}] {}", r.index, r.title)).strong().small());
                                if !r.excerpt.is_empty() {
                                    ui.label(RichText::new(&r.excerpt).small().color(c.text_muted));
                                }
                            }
                        });
                }
                let done = !(k == last && self.pending.is_some());
                if done && !m.error {
                    ui.horizontal(|ui| {
                        if ui
                            .small_button(pick("Insert", "Insertar"))
                            .on_hover_text(pick(
                                "Insert after the cursor or the selection of the document (without the citation marks)",
                                "Insertar tras el cursor o la selección del documento (sin las marcas de cita)",
                            ))
                            .clicked()
                        {
                            act = Some(AssistAct::Insert(strip_citations(&m.text)));
                        }
                        if ui
                            .add_enabled(selection.is_some(), egui::Button::new(pick("Replace", "Reemplazar")).small())
                            .on_hover_text(pick(
                                "Replace the current selection of the document with the answer",
                                "Reemplazar la selección actual del documento por la respuesta",
                            ))
                            .clicked()
                        {
                            act = Some(AssistAct::Replace(strip_citations(&m.text)));
                        }
                        let copied = self.copied == Some(k);
                        if ui
                            .small_button(if copied { pick("Copied", "Copiado") } else { pick("Copy", "Copiar") })
                            .clicked()
                        {
                            ui.ctx().copy_text(m.text.clone());
                            self.copied = Some(k);
                        }
                    });
                }
            }
        });
        act
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn citations_are_removed_before_inserting() {
        assert_eq!(strip_citations("El plazo vence el lunes [1]. Ver [2] y [12]."), "El plazo vence el lunes. Ver y.");
        assert_eq!(strip_citations("Una [nota] y un [1a]"), "Una [nota] y un [1a]", "solo números");
        assert_eq!(strip_citations("Sin citas"), "Sin citas");
    }

    /// Preguntar manda la pregunta (con la selección como contexto) por el hilo de red; la respuesta
    /// llega por partes y al final con sus fuentes; Insertar la deja lista sin las citas.
    #[test]
    fn asking_streams_the_answer_and_inserts_it() {
        use std::sync::mpsc::channel;
        iurefficient_ui::lang::set_lang(iurefficient_ui::lang::Lang::Es);
        let (tx, server_rx) = channel();
        let (server_tx, rx) = channel();
        let mut iure = IurePanel::with_link(None, tx, rx);
        iure.status = Some(crate::iure::Status::Ready {
            name: "Ana".into(),
            email: "a@x.mx".into(),
            host: "x.mx".into(),
            case_label: "caso".into(),
        });
        let mut a = Assistant { context: Context::Selection, ..Default::default() };
        a.send(
            &mut iure,
            None,
            "¿Está bien?",
            false,
            &DocCtx { name: "nota", text: "Texto completo", selection: Some("una cláusula") },
        );
        let Ok(Req::Ask { id, case_id, conversation, message, .. }) = server_rx.try_recv() else {
            panic!("sin pregunta")
        };
        assert_eq!((case_id, conversation), (None, None));
        assert!(message.starts_with("¿Está bien?") && message.ends_with("una cláusula"), "{message}");
        server_tx.send(Rep::Token { id, so_far: "Sí, ".into() }).unwrap();
        iure.poll();
        a.poll(&mut iure);
        assert_eq!(a.msgs.last().map(|m| m.text.as_str()), Some("Sí, "));
        let answer = iurefficient_connect::chat::Answer {
            content: "Sí, está bien [1].".into(),
            references: vec![Reference {
                index: 1,
                kind: "document".into(),
                title: "Contrato".into(),
                excerpt: "…".into(),
                entity_id: None,
            }],
            model: None,
            message_id: "m".into(),
        };
        server_tx.send(Rep::Answer { id, conversation: "c9".into(), answer }).unwrap();
        iure.poll();
        a.poll(&mut iure);
        assert_eq!(a.pending, None);
        assert_eq!(a.conversation, Some((None, "c9".into())));
        assert_eq!(a.msgs.last().map(|m| m.refs.len()), Some(1));
        assert_eq!(strip_citations(&a.msgs.last().unwrap().text), "Sí, está bien.");
        // La siguiente sigue en la misma conversación.
        a.send(&mut iure, None, "¿Y el plazo?", false, &DocCtx { name: "nota", text: "Texto", selection: None });
        let Ok(Req::Ask { conversation, .. }) = server_rx.try_recv() else { panic!("sin pregunta") };
        assert_eq!(conversation.as_deref(), Some("c9"));
    }
}
