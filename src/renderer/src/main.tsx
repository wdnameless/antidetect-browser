import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { applyStoredTheme } from './theme';
import './styles.css';

// Apply the saved theme BEFORE the first render. Doing it in an effect would paint one frame
// in the default theme first, which reads as a flash for anyone who chose light.
applyStoredTheme();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>
  );
}
