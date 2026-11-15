import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Tooltip from '@radix-ui/react-tooltip';
import './base.css';

// Isolated prototype: never mount the production App or its device polling effects.
const parameters = new URLSearchParams(window.location.search);
const prototypeMode = import.meta.env.DEV && parameters.has('prototype');
const App = React.lazy(() => prototypeMode ? import('./prototype/Prototype') : import.meta.env.DEV && parameters.has('preview') ? import('./App') : import.meta.env.DEV && parameters.has('desktop-test') ? import('./testing/DesktopHarness') : import('./desktop/Desktop'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Tooltip.Provider delayDuration={350}>
      <React.Suspense fallback={<p role="status" style={{ padding: 24 }}>正在打开 SyncFu…</p>}>
        <App />
      </React.Suspense>
    </Tooltip.Provider>
  </React.StrictMode>,
);
