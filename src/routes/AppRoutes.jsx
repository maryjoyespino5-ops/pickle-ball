import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Navbar } from "../components/layout/Navbar";
import { Footer } from "../components/layout/Footer";
import { CustomerSidebar } from "../components/layout/CustomerSidebar";
import { ProtectedRoute } from "./ProtectedRoute";
import { Home } from "../pages/public/Home";
import { Courts } from "../pages/public/Courts";
import { Availability } from "../pages/public/Availability";
import { Pricing } from "../pages/public/Pricing";
import { Contact } from "../pages/public/Contact";
import { Login } from "../pages/auth/Login";
import { Register } from "../pages/auth/Register";
import { ForgotPassword } from "../pages/auth/ForgotPassword";
import { Dashboard } from "../pages/customer/Dashboard";
import { BookCourt } from "../pages/customer/BookCourt";
import { MyBookings } from "../pages/customer/MyBookings";
import { BookingHistory } from "../pages/customer/BookingHistory";
import { Profile } from "../pages/customer/Profile";
import { AdminRoute } from "./AdminRoute";
import { AdminSidebar } from "../components/layout/AdminSidebar";
import { AdminTopbar } from "../components/layout/AdminTopbar";
import { Dashboard as AdminDashboard } from "../pages/admin/Dashboard";
import { Bookings as AdminBookings } from "../pages/admin/Bookings";
import { Calendar as AdminCalendar } from "../pages/admin/Calendar";
import { Courts as AdminCourts } from "../pages/admin/Courts";
import { Customers as AdminCustomers } from "../pages/admin/Customers";
import { Payments as AdminPayments } from "../pages/admin/Payments";
import { Reports as AdminReports } from "../pages/admin/Reports";
import { Settings as AdminSettings } from "../pages/admin/Settings";

function PublicLayout() {
  return (
    <>
      <Navbar />
      <div className="public-page">
        <Outlet />
      </div>
      <Footer />
    </>
  );
}
function CustomerLayout() {
  return (
    <div className="customer-shell">
      <CustomerSidebar />
      <div className="customer-content">
        <div className="mobile-customer-header">
          <span className="brand-mark">R</span>
          <span>My Rally</span>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
function AdminLayout() {
  return (
    <div className="admin-shell">
      <AdminSidebar />
      <main className="admin-main">
        <AdminTopbar />
        <Outlet />
      </main>
    </div>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/courts" element={<Courts />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>
      <Route
        element={
          <ProtectedRoute>
            <CustomerLayout />
          </ProtectedRoute>
        }>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/book" element={<BookCourt />} />
        <Route path="/my-bookings" element={<MyBookings />} />
        <Route path="/history" element={<BookingHistory />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route
        element={
          <AdminRoute>
            <AdminLayout />
          </AdminRoute>
        }>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/bookings" element={<AdminBookings />} />
        <Route path="/admin/calendar" element={<AdminCalendar />} />
        <Route path="/admin/courts" element={<AdminCourts />} />
        <Route path="/admin/customers" element={<AdminCustomers />} />
        <Route path="/admin/payments" element={<AdminPayments />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
