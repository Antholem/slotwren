import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Users } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageBody, PageHeader } from "@/components/dashboard/page-header";
import { formatInZone } from "@/lib/dates";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { getDashboardContext } from "@/server/auth/dashboard";
import { CUSTOMER_SORTS, type CustomerSort, listCustomers } from "@/server/db/queries/customers";

import { CustomerSearch } from "./customer-search";

export const metadata: Metadata = { title: "Customers" };

const PAGE_SIZE = 25;
const focusRing = "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

type Query = { q: string; sort: CustomerSort; dir: "asc" | "desc"; page: number };

function parse(params: Record<string, string | string[] | undefined>): Query {
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const sort = one("sort");
  const page = Number(one("page"));
  return {
    q: (one("q") ?? "").trim().slice(0, 100),
    sort: (CUSTOMER_SORTS as readonly string[]).includes(sort ?? "")
      ? (sort as CustomerSort)
      : "name",
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

function hrefFor(query: Query, next: Partial<Query>): Route {
  const merged = { ...query, ...next };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.sort !== "name") params.set("sort", merged.sort);
  if (merged.dir === "desc") params.set("dir", "desc");
  if (merged.page > 1) params.set("page", String(merged.page));
  const qs = params.toString();
  return `/app/customers${qs ? `?${qs}` : ""}` as Route;
}

/** Customers: everyone who has booked, with visits, last visit and total spent. */
export default function CustomersPage({ searchParams }: PageProps<"/app/customers">) {
  return (
    <PageBody label="Customers">
      <PageHeader title="Customers" description="Everyone who has booked with you." />
      <Suspense fallback={<CustomersSkeleton />}>
        <Customers searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function Customers({ searchParams }: Pick<PageProps<"/app/customers">, "searchParams">) {
  const query = parse(await searchParams);
  const { claims, business } = await getDashboardContext();
  const now = new Date();
  const { rows, total } = await listCustomers(claims, business.id, {
    q: query.q,
    sort: query.sort,
    dir: query.dir,
    limit: PAGE_SIZE,
    offset: (query.page - 1) * PAGE_SIZE,
    now,
  });
  const first = total === 0 ? 0 : (query.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, query.page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const sortHeader = (label: string, sort: CustomerSort, align?: "right", edge?: string) => {
    const active = query.sort === sort;
    // Names start A–Z; numbers and dates start with the biggest or latest.
    const nextDir: "asc" | "desc" = active
      ? query.dir === "asc"
        ? "desc"
        : "asc"
      : sort === "name"
        ? "asc"
        : "desc";
    return (
      <th
        scope="col"
        aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
        className={cn("px-3 py-3 font-normal", align === "right" && "text-right", edge)}
      >
        <Link
          href={hrefFor(query, { sort, dir: nextDir, page: 1 })}
          scroll={false}
          className={cn(
            "inline-flex min-h-11 items-center gap-1 rounded hover:text-foreground",
            active && "text-foreground",
            focusRing,
          )}
        >
          {label}
          {active &&
            (query.dir === "asc" ? (
              <ArrowUp aria-hidden className="size-3.5" />
            ) : (
              <ArrowDown aria-hidden className="size-3.5" />
            ))}
        </Link>
      </th>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <CustomerSearch initial={query.q} />
      <div className="relative overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[48rem] border-collapse text-left text-body">
          <caption className="sr-only">Customers</caption>
          <thead>
            <tr className="border-b text-body-sm text-muted-foreground">
              {sortHeader("Name", "name", undefined, "pl-6")}
              <th scope="col" className="px-3 py-3 font-normal">
                Contact
              </th>
              {sortHeader("Visits", "visits", "right")}
              {sortHeader("Last visit", "last_visit")}
              {sortHeader("Total spent", "spent", "right")}
              <th scope="col" className="py-3 pr-6 text-right font-normal">
                Upcoming
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/50">
                <td className="py-4 pl-6">
                  <Link
                    href={`/app/customers/${row.id}` as Route}
                    className={cn("rounded text-label hover:underline", focusRing)}
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-4">
                  <span className="block text-body-sm">{row.email}</span>
                  {row.phone && (
                    <span className="block text-body-sm text-muted-foreground">{row.phone}</span>
                  )}
                </td>
                <td className="px-3 py-4 text-right font-mono tabular-nums">{row.visits}</td>
                <td className="px-3 py-4 whitespace-nowrap">
                  {row.lastVisit ? (
                    formatInZone(row.lastVisit, business.timezone, "d MMM yyyy")
                  ) : (
                    <span className="text-muted-foreground">No visits yet</span>
                  )}
                </td>
                <td className="px-3 py-4 text-right font-mono tabular-nums">
                  {formatAmount(row.totalSpentCents, business.currency)}
                </td>
                <td className="py-4 pr-6 text-right font-mono tabular-nums">{row.upcoming}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-14 items-center justify-center rounded-xl bg-primary-tint text-primary-tint-foreground">
              <Users aria-hidden className="size-6" />
            </span>
            <h2 className="text-title">{query.q ? "No customers match" : "No customers yet"}</h2>
            <p className="max-w-md text-body text-muted-foreground">
              {query.q
                ? `Nobody's name or email contains “${query.q}”.`
                : "Customers appear here after their first booking."}
            </p>
          </div>
        )}
      </div>
      {total > 0 && (
        <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-body text-muted-foreground">
            Showing{" "}
            <span className="font-mono text-foreground tabular-nums">
              {first}–{last}
            </span>{" "}
            of <span className="font-mono text-foreground tabular-nums">{total}</span>
          </p>
          {pages > 1 && (
            <div className="flex gap-2">
              <PageStep
                href={query.page > 1 ? hrefFor(query, { page: query.page - 1 }) : null}
                label="Previous page"
              >
                <ChevronLeft aria-hidden className="size-5" />
              </PageStep>
              <PageStep
                href={query.page < pages ? hrefFor(query, { page: query.page + 1 }) : null}
                label="Next page"
              >
                <ChevronRight aria-hidden className="size-5" />
              </PageStep>
            </div>
          )}
        </nav>
      )}
    </div>
  );
}

function PageStep({
  href,
  label,
  children,
}: {
  href: Route | null;
  label: string;
  children: React.ReactNode;
}) {
  const style = cn("flex size-11 items-center justify-center rounded-lg border bg-card", focusRing);
  return href ? (
    <Link href={href} aria-label={label} className={cn(style, "hover:bg-muted")}>
      {children}
    </Link>
  ) : (
    <span aria-disabled="true" aria-label={label} className={cn(style, "opacity-50")}>
      {children}
    </span>
  );
}

function CustomersSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading customers" className="flex flex-col gap-6">
      <div className="h-11 w-full max-w-md animate-pulse rounded-lg bg-muted" />
      <div className="flex flex-col divide-y rounded-xl border bg-card">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-6 px-6 py-5">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-5 w-56 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-5 w-16 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
