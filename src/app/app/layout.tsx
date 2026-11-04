import { Suspense } from "react";

import { AppToaster } from "@/components/dashboard/app-toaster";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopBar, TopBarSkeleton } from "@/components/dashboard/top-bar";
import { getDashboardContext } from "@/server/auth/dashboard";

import { switchBusiness } from "./actions";

/**
 * Owner dashboard shell (docs/design/owner-dashboard/shell-*): sidebar on
 * desktop, a menu sheet on mobile, and a top bar with the business switcher
 * and account menu. The session is read inside Suspense, so the frame streams
 * instantly.
 */
export default function DashboardLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="flex min-h-dvh flex-1 bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopBarSkeleton />}>
          <DashboardTopBar />
        </Suspense>
        {children}
      </div>
      <AppToaster />
    </div>
  );
}

async function DashboardTopBar() {
  const { business, businesses, role, user } = await getDashboardContext();
  return (
    <TopBar
      business={{ id: business.id, name: business.name, logoUrl: business.logoUrl }}
      businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
      role={role}
      email={user.email}
      switchBusiness={switchBusiness}
    />
  );
}
