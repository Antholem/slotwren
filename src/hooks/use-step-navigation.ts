"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Continue to the next booking step. `pending` stays true until the new step
 * has rendered, so Continue shows a spinner (and can't be tapped twice) on a
 * slow connection instead of looking dead.
 */
export function useStepNavigation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return { pending, push: (href: Route) => startTransition(() => router.push(href)) };
}
