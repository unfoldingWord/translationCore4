import React from 'react';
import { createRoot } from 'react-dom/client';
import './ds/styles.css';
import './ui.css';
import { AppProvider, internet } from './state.jsx';
import { guardFetch } from './data/internet';
import App from './App.jsx';
import DevAnnotate from './DevAnnotate.jsx';

// D95 (#559): the one boundary for every request the client makes. While the
// internet is off, a request to another origin or to a platform route that
// uses the internet is refused before it is sent.
window.fetch = guardFetch(window.fetch.bind(window), internet, window.location.origin);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider>
      <App />
      <DevAnnotate />
    </AppProvider>
  </React.StrictMode>
);
