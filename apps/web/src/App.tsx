import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { EmptyState, PageHeader } from "./components/ui";
import { useI18n } from "./i18n";
import { EditorPage } from "./pages/Editor";
import { GeneratePage } from "./pages/Generate";
import { HomePage } from "./pages/Home";
import { LibraryPage } from "./pages/Library";
import { ModelsPage } from "./pages/Models";
import { OnboardingPage } from "./pages/Onboarding";
import { QueuePage } from "./pages/Queue";
import { SettingsPage } from "./pages/Settings";
import { StudioPage } from "./pages/Studio";

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHeader title={t("errors.not_found")} />
      <EmptyState title={t("errors.generic")} body={t("errors.not_found")} />
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="generate/:task" element={<GeneratePage />} />
        <Route path="editor" element={<EditorPage />} />
        <Route path="editor/:assetId" element={<EditorPage />} />
        <Route path="studio" element={<StudioPage />} />
        <Route path="studio/:projectId" element={<StudioPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="onboarding" element={<OnboardingPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
