import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import LoginPage from './features/auth/login-page';
import { AuthProvider, useAuth } from './hooks/use-auth';
import DashboardPage from './features/dashboard/page';
import DatasetsPage from './features/datasets/page';
import TrainingPage from './features/training/page';
import JobsPage from './features/jobs/page';
import RuntimePage from './features/runtime/page';
import PlaygroundPage from './features/playground/page';
import SettingsPage from './features/settings/page';
import ModelsPage from './features/models/page';
import LorasPage from './features/loras/page';
import LogsPage from './features/logs/logs-page';
import MonitorPage from './features/monitor/monitor-page';
import ComparisonsPage from './features/comparisons/page';
import EvaluationsPage from './features/evaluations/evaluations-page';
import WorkersPage from './features/workers/page';
import { useEvents } from './hooks/use-events';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="h-screen w-full flex items-center justify-center bg-slate-950 text-white">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  useEvents();

  return (
    <AuthProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/app" element={<PrivateRoute><AppShell /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="loras" element={<LorasPage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="training" element={<TrainingPage />} />
        <Route path="comparisons" element={<ComparisonsPage />} />
        <Route path="evaluations" element={<EvaluationsPage />} />
        <Route path="workers" element={<WorkersPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="runtime" element={<RuntimePage />} />
        <Route path="playground" element={<PlaygroundPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="monitor" element={<MonitorPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
    </AuthProvider>
  );
}