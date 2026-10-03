import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PrivilegedSessionProvider } from './context/PrivilegedSessionContext';
import { ThemeProvider } from './context/ThemeContext';
import { DesignSystemProvider } from './context/DesignSystemContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DesignSystemProvider>
            <PrivilegedSessionProvider>
              <App />
            </PrivilegedSessionProvider>
          </DesignSystemProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
