import type { ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useParams } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { SettingsProvider } from "../state/settings";
import { ToastProvider } from "../state/toast";

/**
 * Render a page with the same provider stack the real app uses, minus the
 * AppShell navigation. Tests that need route parameters or navigation
 * assertions pass a `<Routes>` tree containing the page plus a
 * `<LocationProbe />` route.
 */
export function renderPage(ui: ReactNode, options: { route?: string } = {}): RenderResult {
  return render(
    <I18nProvider initialLanguage="en">
      <ToastProvider>
        <SettingsProvider>
          <MemoryRouter initialEntries={[options.route ?? "/"]}>{ui}</MemoryRouter>
        </SettingsProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

/** Renders the current location and route params so navigation is assertable. */
export function LocationProbe() {
  const location = useLocation();
  const params = useParams();
  return (
    <output data-testid="location">
      {JSON.stringify({ pathname: location.pathname, params })}
    </output>
  );
}

/** Convenience wrapper for rendering a page element at an explicit path. */
export function pageRoutes(
  path: string,
  element: ReactNode,
  probes: Array<{ path: string }> = [],
): ReactNode {
  return (
    <Routes>
      <Route path={path} element={element} />
      {probes.map((probe) => (
        <Route key={probe.path} path={probe.path} element={<LocationProbe />} />
      ))}
    </Routes>
  );
}
