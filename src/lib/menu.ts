import { Menu, Submenu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { basename } from './fileio';

export interface MenuActions {
  onNew: () => void;
  onOpen: () => void;
  onOpenRecent: (path: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
  onQuit: () => void;
}

/**
 * (Re)construye el menú nativo. Se vuelve a llamar cuando cambia la lista de
 * archivos recientes.
 */
export const buildAppMenu = async (
  actions: MenuActions,
  recentFiles: string[]
): Promise<void> => {
  const recentItems = await Promise.all(
    recentFiles.map((path) =>
      MenuItem.new({
        id: `recent:${path}`,
        text: basename(path),
        action: () => actions.onOpenRecent(path),
      })
    )
  );

  const recentSubmenu = await Submenu.new({
    text: 'Abrir reciente',
    enabled: recentItems.length > 0,
    items: recentItems,
  });

  const fileSubmenu = await Submenu.new({
    text: 'Archivo',
    items: [
      await MenuItem.new({
        id: 'new',
        text: 'Nuevo',
        accelerator: 'CmdOrCtrl+N',
        action: actions.onNew,
      }),
      await MenuItem.new({
        id: 'open',
        text: 'Abrir…',
        accelerator: 'CmdOrCtrl+O',
        action: actions.onOpen,
      }),
      recentSubmenu,
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'save',
        text: 'Guardar',
        accelerator: 'CmdOrCtrl+S',
        action: actions.onSave,
      }),
      await MenuItem.new({
        id: 'saveAs',
        text: 'Guardar como…',
        accelerator: 'CmdOrCtrl+Shift+S',
        action: actions.onSaveAs,
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'exportPdf',
        text: 'Exportar a PDF…',
        action: actions.onExportPdf,
      }),
      await MenuItem.new({
        id: 'exportDocx',
        text: 'Exportar a DOCX…',
        action: actions.onExportDocx,
      }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await MenuItem.new({
        id: 'quit',
        text: 'Salir',
        accelerator: 'CmdOrCtrl+Q',
        action: actions.onQuit,
      }),
    ],
  });

  const editSubmenu = await Submenu.new({
    text: 'Edición',
    items: [
      await PredefinedMenuItem.new({ item: 'Undo', text: 'Deshacer' }),
      await PredefinedMenuItem.new({ item: 'Redo', text: 'Rehacer' }),
      await PredefinedMenuItem.new({ item: 'Separator' }),
      await PredefinedMenuItem.new({ item: 'Cut', text: 'Cortar' }),
      await PredefinedMenuItem.new({ item: 'Copy', text: 'Copiar' }),
      await PredefinedMenuItem.new({ item: 'Paste', text: 'Pegar' }),
      await PredefinedMenuItem.new({ item: 'SelectAll', text: 'Seleccionar todo' }),
    ],
  });

  const menu = await Menu.new({ items: [fileSubmenu, editSubmenu] });
  await menu.setAsAppMenu();
};
