import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './styles/glass-crm.css';
import './styles/app.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(<App />);
}
