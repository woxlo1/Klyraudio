import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { SettingsProvider } from "./state/settings";
import { ToastProvider } from "./state/toast";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("Klyraudio: #root element is missing");

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <SettingsProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </SettingsProvider>
    </I18nProvider>
  </StrictMode>,
);
