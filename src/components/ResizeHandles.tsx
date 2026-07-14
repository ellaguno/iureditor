import { getCurrentWindow } from '@tauri-apps/api/window';

// Con decorations:false la ventana pierde los bordes de redimensionado del
// sistema. Estas franjas invisibles en bordes y esquinas restauran la
// funcionalidad vía startResizeDragging.

type Direction =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West';

const EDGE = 6; // px de zona de agarre en bordes
const CORNER = 14; // px en esquinas

const HANDLES: { dir: Direction; style: React.CSSProperties; cursor: string }[] = [
  { dir: 'North', cursor: 'n-resize', style: { top: 0, left: CORNER, right: CORNER, height: EDGE } },
  { dir: 'South', cursor: 's-resize', style: { bottom: 0, left: CORNER, right: CORNER, height: EDGE } },
  { dir: 'West', cursor: 'w-resize', style: { left: 0, top: CORNER, bottom: CORNER, width: EDGE } },
  { dir: 'East', cursor: 'e-resize', style: { right: 0, top: CORNER, bottom: CORNER, width: EDGE } },
  { dir: 'NorthWest', cursor: 'nw-resize', style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { dir: 'NorthEast', cursor: 'ne-resize', style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { dir: 'SouthWest', cursor: 'sw-resize', style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { dir: 'SouthEast', cursor: 'se-resize', style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
];

export const ResizeHandles = () => (
  <>
    {HANDLES.map(({ dir, style, cursor }) => (
      <div
        key={dir}
        style={{ position: 'fixed', zIndex: 9999, cursor, ...style }}
        onMouseDown={async (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const win = getCurrentWindow();
          if (await win.isMaximized()) return;
          void win.startResizeDragging(dir);
        }}
      />
    ))}
  </>
);
