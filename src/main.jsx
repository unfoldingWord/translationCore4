import React from 'react';
import { createRoot } from 'react-dom/client';
import './ds/styles.css';
import './ui.css';
import { AppProvider } from './state.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
