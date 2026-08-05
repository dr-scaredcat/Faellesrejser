import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import { NavBar } from './components/NavBar';
import LoginPage from './pages/LoginPage';
import TripsListPage from './pages/TripsListPage';
import ArchivedTripsPage from './pages/ArchivedTripsPage';
import TripCreatePage from './pages/TripCreatePage';
import UserPage from './pages/UserPage';
import TripLayout from './pages/TripLayout';
import TripOverviewPage from './pages/TripOverviewPage';
import PackingListPage from './pages/PackingListPage';
import ItineraryPage from './pages/ItineraryPage';
import ExpensesPage from './pages/ExpensesPage';
import DrivingPage from './pages/DrivingPage';
import AdminLayout from './pages/admin/AdminLayout';
import AdminGeneralPage from './pages/admin/AdminGeneralPage';
import AdminDesignPage from './pages/admin/AdminDesignPage';
import AdminExpenseCategoriesPage from './pages/admin/AdminExpenseCategoriesPage';
import AdminNavigationPage from './pages/admin/AdminNavigationPage';
import AdminGudenaaPage from './pages/admin/AdminGudenaaPage';
import RoutePlannerPage from './pages/gudenaa/RoutePlannerPage';
import StatisticsPage from './pages/gudenaa/StatisticsPage';
import SailingTimesPage from './pages/gudenaa/SailingTimesPage';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-river-50">
      <NavBar />
      {children}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Shell>
              <TripsListPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/arkiv"
        element={
          <ProtectedRoute>
            <Shell>
              <ArchivedTripsPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rejser/ny"
        element={
          <ProtectedRoute>
            <Shell>
              <TripCreatePage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profil"
        element={
          <ProtectedRoute>
            <Shell>
              <UserPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <Shell>
                <AdminLayout />
              </Shell>
            </AdminRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="generelt" replace />} />
        <Route path="generelt" element={<AdminGeneralPage />} />
        <Route path="design" element={<AdminDesignPage />} />
        <Route path="regnskab" element={<AdminExpenseCategoriesPage />} />
        <Route path="navigation" element={<AdminNavigationPage />} />
        <Route path="gudenaaen" element={<AdminGudenaaPage />} />
      </Route>

      <Route
        path="/rejser/:tripId"
        element={
          <ProtectedRoute>
            <Shell>
              <TripLayout />
            </Shell>
          </ProtectedRoute>
        }
      >
        <Route index element={<TripOverviewPage />} />
        <Route path="pakkeliste" element={<PackingListPage />} />
        <Route path="rejseplan" element={<ItineraryPage />} />
        <Route path="regnskab" element={<ExpensesPage />} />
        <Route path="koersel" element={<DrivingPage />} />
        <Route path="ruteplanlaegger" element={<RoutePlannerPage />} />
        <Route path="statistik" element={<StatisticsPage />} />
        <Route path="sejltider" element={<SailingTimesPage />} />
      </Route>
    </Routes>
  );
}
