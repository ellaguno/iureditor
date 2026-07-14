import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Printer } from 'lucide-react';
import { previewChannel } from '../lib/exportPdf';
import type { PreviewPayload } from '../lib/exportPdf';
import '../styles/print.css';

/**
 * Ventana de vista previa para exportar a PDF. Recibe el HTML ya
 * autosuficiente (mermaid como SVG inline, imágenes como data URLs) desde la
 * ventana principal vía eventos de Tauri, y lanza el diálogo nativo de
 * impresión donde el usuario elige "Guardar como PDF".
 */
export const PrintPreview = () => {
  const [payload, setPayload] = useState<PreviewPayload | null>(null);

  useEffect(() => {
    const unlistenPromise = previewChannel.onContent((p) => {
      setPayload(p);
      document.title = `Vista previa — ${p.title}`;
    });
    void previewChannel.announceReady();
    return () => {
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  const handlePrint = async () => {
    try {
      window.print();
    } catch {
      /* sigue el fallback */
    }
    // Fallback nativo (WKWebView en macOS es poco fiable con window.print()).
    if (navigator.userAgent.includes('Mac')) {
      try {
        await invoke('print_webview');
      } catch (err) {
        console.error('print_webview fallback falló:', err);
      }
    }
  };

  if (!payload) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="print-preview-root min-h-full bg-gray-100 dark:bg-gray-950">
      {/* Barra de acciones — oculta al imprimir */}
      <div className="print-hide sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center justify-between no-select">
        <span className="text-sm text-gray-600 dark:text-gray-300">
          Vista previa — elige «Guardar como PDF» en el diálogo de impresión
        </span>
        <button
          onClick={() => void handlePrint()}
          className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-1.5"
        >
          <Printer className="w-4 h-4" />
          Imprimir / Guardar PDF
        </button>
      </div>

      {/* Hoja */}
      <div className="print-sheet bg-white text-gray-900 max-w-[21cm] mx-auto my-6 shadow-lg">
        <div
          className="markdown-content print-content p-[2cm]"
          dangerouslySetInnerHTML={{ __html: payload.html }}
        />
      </div>
    </div>
  );
};
