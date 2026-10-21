// Texto dictado que llega por el enlace `iureditor://insert` (IureVoz). Viene como
// Markdown de una línea a la vez: «\n» es un bloque nuevo y un renglón puede empezar
// con «# », «- », «1. », «- [ ] » o «> ». Se aplica con los comandos del editor y no
// como HTML, para que dentro de una lista un salto sea un elemento nuevo (no un
// párrafo dentro del mismo) y un renglón sin marca salga de la lista.
import type { Editor } from '@tiptap/core';

type Marca =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3 | 4 | 5 | 6; largo: number }
  | { tipo: 'vinieta' | 'numerada' | 'casilla' | 'cita'; largo: number };

export const marcaDeLinea = (linea: string): Marca | null => {
  let m = /^(#{1,6}) /.exec(linea);
  if (m) return { tipo: 'titulo', nivel: m[1].length as 1 | 2 | 3 | 4 | 5 | 6, largo: m[0].length };
  if ((m = /^[-*+] \[[ xX]\] /.exec(linea))) return { tipo: 'casilla', largo: m[0].length };
  if ((m = /^[-*+] /.exec(linea))) return { tipo: 'vinieta', largo: m[0].length };
  if ((m = /^\d+\. /.exec(linea))) return { tipo: 'numerada', largo: m[0].length };
  if ((m = /^> /.exec(linea))) return { tipo: 'cita', largo: m[0].length };
  return null;
};

const enLista = (e: Editor) => e.isActive('bulletList') || e.isActive('orderedList') || e.isActive('taskList');
const bloqueVacio = (e: Editor) => e.state.selection.$from.parent.textContent === '';
const esDeLista = (m: Marca | null) => !!m && (m.tipo === 'vinieta' || m.tipo === 'numerada' || m.tipo === 'casilla');

/** Un salto de línea: elemento nuevo en una lista, o párrafo nuevo. */
const nuevoBloque = (e: Editor, siguiente: string) => {
  if (enLista(e)) {
    const item = e.isActive('taskItem') ? 'taskItem' : 'listItem';
    if (bloqueVacio(e)) {
      // elemento vacío: se sale de la lista (como pulsar Enter dos veces)
      e.chain().liftListItem(item).run();
      return;
    }
    e.chain().splitListItem(item).run();
    if (!esDeLista(marcaDeLinea(siguiente))) e.chain().liftListItem(item).run();
    return;
  }
  // «punto y aparte» seguido de «viñeta» da «\n\n»: no se apilan párrafos vacíos
  if (bloqueVacio(e)) return;
  e.chain().splitBlock().run();
};

const aplicarMarca = (e: Editor, m: Marca) => {
  switch (m.tipo) {
    case 'titulo':
      e.chain().setHeading({ level: m.nivel }).run();
      break;
    case 'vinieta':
      if (!e.isActive('bulletList')) e.chain().toggleBulletList().run();
      break;
    case 'numerada':
      if (!e.isActive('orderedList')) e.chain().toggleOrderedList().run();
      break;
    case 'casilla':
      // la extensión de casillas puede no estar cargada: entonces queda como viñeta
      if (!e.isActive('taskList') && !e.commands.toggleTaskList?.()) {
        if (!e.isActive('bulletList')) e.chain().toggleBulletList().run();
      }
      break;
    case 'cita':
      if (!e.isActive('blockquote')) e.chain().toggleBlockquote().run();
      break;
  }
};

/** Inserta un tramo de dictado en el cursor. */
export const insertarDictado = (e: Editor, texto: string) => {
  texto.split('\n').forEach((original, i) => {
    let linea = original;
    if (i > 0) nuevoBloque(e, linea);
    if (!linea) return;
    const marca = i > 0 || bloqueVacio(e) ? marcaDeLinea(linea) : null;
    if (marca) {
      aplicarMarca(e, marca);
      linea = linea.slice(marca.largo);
    }
    // al empezar un bloque sobra el espacio con que llega la frase siguiente
    if (bloqueVacio(e)) linea = linea.trimStart();
    if (linea) e.chain().insertContent({ type: 'text', text: linea }).run();
  });
  e.commands.scrollIntoView();
};
