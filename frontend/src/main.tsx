import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { bootPortal } from './app.ts';

bootPortal();

const bridgeEl = document.createElement('div');
bridgeEl.id = 'vtc-react-bridge';
bridgeEl.hidden = true;
document.body.appendChild(bridgeEl);
ReactDOM.createRoot(bridgeEl).render(<App />);

