import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/common/ErrorBoundary';
import { initGlobalInputEnhancements } from './utils/inputEnhancements';
import { initGlobalKeyboardNavigation } from './utils/keyboardNavigation';

initGlobalInputEnhancements();
initGlobalKeyboardNavigation();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
