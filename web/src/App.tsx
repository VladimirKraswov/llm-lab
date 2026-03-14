import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import DashboardPage from './features/dashboard/page';
import DatasetsPage from './features/datasets/page';
import TrainingPage from './features/training/page';
import JobsPage from './features/jobs/page';
import RuntimePage from './features/runtime/page';
import PlaygroundPage from './features/playground/page';
import SettingsPage from './features/settings/page';
import ModelsPage from './features/models/page';
import LorasPage from './features/loras/page';
import { useEvents } from './hooks/use-events';

export default function App() {
  useEvents();

  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="loras" element={<LorasPage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="training" element={<TrainingPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="runtime" element={<RuntimePage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}