import React from 'react';
import ReactDOM from 'react-dom/client';
import './editor.css';
import { EditorApp } from './EditorApp';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <EditorApp />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
