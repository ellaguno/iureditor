import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';
import { computePosition, flip, shift, offset } from '@floating-ui/dom';
import type { ComponentType } from 'react';

/** Lo que un menú de sugerencias expone a la extensión: manejo de teclas. */
export interface SuggestionMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export interface SuggestionMenuProps<Item> {
  items: Item[];
  command: (item: Item) => void;
}

/** `render` de @tiptap/suggestion: monta `Component` en un popup flotante
 *  junto al cursor (menú `/`, autocompletado de `[[`). Escape lo oculta sin
 *  cancelar la sugerencia; el resto de teclas las decide el menú. */
export const suggestionPopup = <Item>(
  Component: ComponentType<SuggestionMenuProps<Item> & React.RefAttributes<SuggestionMenuRef>>
): SuggestionOptions<Item>['render'] =>
  () => {
    let component: ReactRenderer<SuggestionMenuRef, SuggestionMenuProps<Item>> | null = null;
    let el: HTMLElement | null = null;

    const reposition = (props: SuggestionProps<Item>) => {
      if (!el || !props.clientRect) return;
      const rect = props.clientRect();
      if (!rect) return;
      const virtual = { getBoundingClientRect: () => rect };
      void computePosition(virtual, el, {
        placement: 'bottom-start',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      });
    };

    const toProps = (props: SuggestionProps<Item>): SuggestionMenuProps<Item> => ({
      items: props.items,
      command: (item) => props.command(item),
    });

    return {
      onStart: (props) => {
        component = new ReactRenderer(Component, {
          props: toProps(props),
          editor: props.editor,
        }) as unknown as ReactRenderer<SuggestionMenuRef, SuggestionMenuProps<Item>>;
        el = component.element as HTMLElement;
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.zIndex = '50';
        document.body.appendChild(el);
        reposition(props);
      },
      onUpdate: (props) => {
        if (el) el.style.display = '';
        component?.updateProps(toProps(props));
        reposition(props);
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape') {
          if (el) el.style.display = 'none';
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        el?.remove();
        component?.destroy();
        component = null;
        el = null;
      },
    };
  };
