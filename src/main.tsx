import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PrintPreview } from './components/PrintPreview';
import './styles/app.css';
import './styles/tiptap.css';
import './styles/markdown.css';

// La ventana de vista previa de impresión reutiliza el mismo bundle con la
// ruta hash #/print (sin router).
const isPrintPreview = window.location.hash === '#/print';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>{isPrintPreview ? <PrintPreview /> : <App />}</React.StrictMode>
);
