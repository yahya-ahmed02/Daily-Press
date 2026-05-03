import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';

function AppContent() {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="splash">
      <div className="splash-title">The Daily Press</div>
      <div className="splash-spinner" />
    </div>
  );
  return user ? <Dashboard /> : <AuthPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
