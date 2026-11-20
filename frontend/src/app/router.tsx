import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { MemberPortalPage } from "@/pages/portal/MemberPortal";
import { ProtectedRoute } from "./ProtectedRoute";

// Public marketing site
import { PublicLayout } from "@/components/public/PublicLayout";
import { HomePage } from "@/pages/public/Home";
import { MembershipsPage } from "@/pages/public/Memberships";
import { TrainersPage } from "@/pages/public/Trainers";
import { ClassesPage } from "@/pages/public/Classes";
import { AboutPage } from "@/pages/public/About";
import { ContactPage } from "@/pages/public/Contact";
import { ExercisesPage } from "@/pages/public/Exercises";
import { LocationsPage } from "@/pages/public/Locations";

// Authenticated app
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { SettingsPage } from "@/pages/Settings";
import { MembersPage } from "@/pages/Members";
import { BranchesPage } from "@/pages/Branches";
import { TrainersAdminPage } from "@/pages/Trainers";
import { PlansPage } from "@/pages/Plans";
import { RenewalsPage } from "@/pages/Renewals";
import { PaymentsPage } from "@/pages/Payments";
import { WorkoutsPage } from "@/pages/Workouts";
import { DietsPage } from "@/pages/Diets";
import { AttendanceHistoryPage } from "@/pages/AttendanceHistory";
import { ScannerPage } from "@/pages/Scanner";
import { ReportsPage } from "@/pages/Reports";
import { NotificationsPage } from "@/pages/Notifications";
import { AssistantPage } from "@/pages/Assistant";

export const router = createBrowserRouter([
  // Public site
  {
    path: "/",
    element: <PublicLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "memberships", element: <MembershipsPage /> },
      { path: "trainers", element: <TrainersPage /> },
      { path: "classes", element: <ClassesPage /> },
      { path: "exercises", element: <ExercisesPage /> },
      { path: "locations", element: <LocationsPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "contact", element: <ContactPage /> },
    ],
  },

  { path: "/login", element: <LoginPage /> },

  // Member self-service portal
  {
    path: "/portal",
    element: (
      <ProtectedRoute>
        <PortalLayout />
      </ProtectedRoute>
    ),
    children: [{ index: true, element: <MemberPortalPage /> }],
  },

  // Authenticated app (staff)
  {
    path: "/app",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "members", element: <MembersPage /> },
      { path: "branches", element: <BranchesPage /> },
      { path: "plans", element: <PlansPage /> },
      { path: "renewals", element: <RenewalsPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "attendance", element: <AttendanceHistoryPage /> },
      { path: "scanner", element: <ScannerPage /> },
      { path: "trainers", element: <TrainersAdminPage /> },
      { path: "workouts", element: <WorkoutsPage /> },
      { path: "diets", element: <DietsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },

  { path: "*", element: <Navigate to="/" replace /> },
]);
