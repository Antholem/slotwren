import { Suspense } from "react";

import { AppToaster } from "@/components/dashboard/app-toaster";
import { LiveBookings } from "@/components/dashboard/live-bookings";
import { Sidebar } from "@/components/dashboard/sidebar";
import { TopBar, TopBarSkeleton } from "@/components/dashboard/top-bar";
import { TopBarBoundary } from "@/components/dashboard/top-bar-boundary";
import { getDashboardContext } from "@/server/auth/dashboard";

import { paletteSearchAction, saveProfileAction, switchBusiness } from "./actions";

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
        {/* Its own error boundary: a failed session lookup leaves a plain bar,
            and the page's error state (app/error.tsx) renders below it. */}
        <TopBarBoundary>
          <Suspense fallback={<TopBarSkeleton />}>
            <DashboardTopBar />
          </Suspense>
        </TopBarBoundary>
        {children}
      </div>
      <AppToaster />
    </div>
  );
}

async function DashboardTopBar() {
  const { business, businesses, role, user, profileName } = await getDashboardContext();
  return (
    <>
      <TopBar
        business={{ id: business.id, name: business.name, logoUrl: business.logoUrl }}
        businesses={businesses.map((b) => ({ id: b.id, name: b.name }))}
        role={role}
        email={user.email}
        profileName={profileName}
        switchBusiness={switchBusiness}
        saveProfile={saveProfileAction}
        search={paletteSearchAction}
        timezone={business.timezone}
      />
      {/* Keyed by business: switching businesses resubscribes. */}
      <LiveBookings
        key={business.id}
        businessId={business.id}
        userId={user.id}
        zone={business.timezone}
        // On the server's clock, like bookings.created_at (the browser's may be off).
        renderedAt={new Date().toISOString()}
      />
    </>
  );
}
