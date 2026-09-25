import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PrintPreview } from './components/PrintPreview';
import { initLang } from './lib/i18n';
import './styles/app.css';
import './styles/tiptap.css';
import './styles/markdown.css';

// La ventana de vista previa de impresión reutiliza el mismo bundle con la
// ruta hash #/print (sin router).
const isPrintPreview = window.location.hash === '#/print';

// El idioma se resuelve antes del primer render para no mostrar un parpadeo
// del idioma por defecto.
void initLang().finally(() => {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>{isPrintPreview ? <PrintPreview /> : <App />}</React.StrictMode>
  );
});
