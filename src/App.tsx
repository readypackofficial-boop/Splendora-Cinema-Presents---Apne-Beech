/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CustomerHome } from './components/CustomerHome';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import { useThemeSync } from './hooks/useThemeSync';

export default function App() {
  useThemeSync();

  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<CustomerHome />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/*" element={<AdminDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
