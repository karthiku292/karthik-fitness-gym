import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  QrCode,
  Dumbbell,
  Salad,
  UserCog,
  BadgeIndianRupee,
  BarChart3,
  Bell,
  Bot,
  Settings,
  CalendarCheck,
  RefreshCw,
} from "lucide-react";
import type { Role } from "@/lib/types";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
}

const NAV: NavItem[] = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "trainer"] },
  { to: "/app/members", label: "Members", icon: Users, roles: ["admin"] },
  { to: "/app/plans", label: "Membership Plans", icon: BadgeIndianRupee, roles: ["admin"] },
  { to: "/app/renewals", label: "Renewals", icon: RefreshCw, roles: ["admin"] },
  { to: "/app/payments", label: "Payments", icon: CreditCard, roles: ["admin"] },
  { to: "/app/attendance", label: "Attendance", icon: CalendarCheck, roles: ["admin", "trainer"] },
  { to: "/app/scanner", label: "QR Scanner", icon: QrCode, roles: ["admin", "trainer"] },
  { to: "/app/trainers", label: "Trainers", icon: UserCog, roles: ["admin"] },
  { to: "/app/workouts", label: "Workouts", icon: Dumbbell, roles: ["admin", "trainer"] },
  { to: "/app/diets", label: "Diets", icon: Salad, roles: ["admin", "trainer"] },
  { to: "/app/reports", label: "Reports", icon: BarChart3, roles: ["admin"] },
  { to: "/app/notifications", label: "Notifications", icon: Bell, roles: ["admin"] },
  { to: "/app/assistant", label: "AI Assistant", icon: Bot, roles: ["admin"] },
  { to: "/app/settings", label: "Settings", icon: Settings, roles: ["admin"] },
];

interface Props {
  role: Role;
  gymName: string;
  logoUrl?: string | null;
  open: boolean;
}

export function Sidebar({ role, gymName, logoUrl, open }: Props) {
  const items = NAV.filter((i) => i.roles.includes(role));
  return (
    <aside
      className={clsx(
        "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface transition-transform duration-300 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center gap-3 px-5 py-5">
        {logoUrl ? (
          <img src={logoUrl} alt={gymName} className="h-9 w-9 rounded-xl object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-gradient font-bold text-[#080808]">
            {gymName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="truncate font-display text-sm font-bold uppercase">{gymName}</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/app"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand/15 text-brand"
                  : "text-muted hover:bg-surface-2 hover:text-white"
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
