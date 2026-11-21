import { PageBody } from "@/components/dashboard/page-header";

const pulse = "animate-pulse rounded-lg bg-muted";

/** Loading Today (docs/design/owner-dashboard/loading-today). */
export function TodaySkeleton() {
  return (
    <PageBody label="Loading today">
      <div aria-busy="true" className="flex flex-col gap-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className={`h-10 w-64 ${pulse}`} />
            <div className={`h-5 w-80 max-w-full ${pulse}`} />
          </div>
          <div className={`size-14 sm:h-11 sm:w-36 ${pulse}`} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {["Bookings today", "This week", "Est. revenue this week", "No-show rate"].map(
            (label) => (
              <div key={label} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:p-6">
                <p className="text-body-sm text-muted-foreground">{label}</p>
                <div className={`h-9 w-24 ${pulse}`} />
                <div className={`h-3 w-32 max-w-full rounded-full ${pulse}`} />
              </div>
            ),
          )}
        </div>
        <div className="hidden flex-col gap-6 rounded-xl border bg-card p-6 md:flex">
          <p className="text-title">Today&rsquo;s appointments</p>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 border-t pt-4">
              <div className="flex w-40 items-center gap-3 lg:w-52">
                <div className="size-10 animate-pulse rounded-full bg-muted" />
                <div className={`h-4 w-20 ${pulse}`} />
              </div>
              <div className="flex flex-1 gap-6">
                <div className={`h-16 w-[12%] ${pulse}`} />
                <div className={`h-16 w-[18%] ${pulse}`} />
                <div className={`ml-[8%] h-16 w-[10%] ${pulse}`} />
                <div className={`ml-[6%] h-16 w-[20%] ${pulse}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
            <p className="text-title">Now and next</p>
            <div className={`h-5 w-11/12 rounded-full ${pulse}`} />
            <div className={`h-5 w-3/4 rounded-full ${pulse}`} />
            <div className={`h-5 w-5/6 rounded-full ${pulse}`} />
          </div>
          <div className="hidden flex-col gap-4 rounded-xl border bg-card p-6 lg:flex">
            <div className={`h-6 w-48 ${pulse}`} />
            <div className={`h-24 w-full ${pulse}`} />
          </div>
        </div>
      </div>
    </PageBody>
  );
}
