import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';

/**
 * Inserta una imagen y deja el cursor DESPUÉS de ella. `setImage` a secas deja
 * la imagen recién insertada seleccionada (NodeSelection): lo siguiente que
 * el usuario tecleaba o pegaba la sustituía — pegar una captura y seguir
 * escribiendo hacía desaparecer la captura. Si tras la imagen no hay un
 * bloque de texto (final del documento o de la celda), se crea un párrafo.
 */
export const insertImageAndContinue = (
  editor: Editor,
  attrs: { src: string; alt?: string; title?: string }
): boolean =>
  editor
    .chain()
    .focus()
    .setImage(attrs)
    .command(({ tr, dispatch }) => {
      const { selection } = tr;
      if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return true;
      const after = selection.to;
      const next = tr.doc.nodeAt(after);
      if (dispatch) {
        if (!next || !next.isTextblock) {
          tr.insert(after, tr.doc.type.schema.nodes.paragraph.create());
        }
        tr.setSelection(TextSelection.create(tr.doc, after + 1));
      }
      return true;
    })
    .run();
