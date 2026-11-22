"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";

/** Search customers by name or email; the URL carries the query (?q=). */
export function CustomerSearch({ initial }: { initial: string }) {
  const id = useId();
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const term = q.trim();
    if (term === initial) return;
    const timer = setTimeout(() => {
      const query = term ? `?q=${encodeURIComponent(term)}` : "";
      startTransition(() => router.replace(`/app/customers${query}` as Route, { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
  }, [q, initial, router]);

  return (
    <div className="relative w-full max-w-md" aria-busy={pending || undefined}>
      <label htmlFor={id} className="sr-only">
        Search customers by name or email
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search by name or email"
        className="h-11 pr-3 pl-9 text-body md:text-body"
      />
    </div>
  );
}
