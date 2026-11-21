"use client";

import { useEffect, useRef } from "react";

// The first heading a visitor lands on keeps the browser's focus where it is;
// every later step (client navigation) takes focus, like a page load would.
let navigated = false;

/**
 * The page's h1, named for the step. After a step change it takes focus,
 * so screen readers announce the new step instead of staying silent on a
 * Continue button that has gone. Visually hidden: the step's own legend or
 * heading says the same.
 */
export function StepHeading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (navigated) ref.current?.focus({ preventScroll: true });
    navigated = true;
  }, [children]);
  return (
    <h1 ref={ref} tabIndex={-1} className="sr-only">
      {children}
    </h1>
  );
}
