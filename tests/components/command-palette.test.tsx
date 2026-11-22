import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CommandPalette, type PaletteResults } from "@/components/dashboard/command-palette";

/*
 * ⌘K's states: "Searching…" alone while a search is in flight (no "Nothing
 * matches" beside it), "Nothing matches" once it comes back empty, and an
 * error line when the search itself fails.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeAll(() => {
  // cmdk and Radix measure and scroll; jsdom has neither.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

const none: PaletteResults = { customers: [], bookings: [] };

async function openAndType(search: (query: string) => Promise<PaletteResults>, text: string) {
  const user = userEvent.setup();
  render(<CommandPalette search={search} zone="Asia/Manila" />);
  await user.click(screen.getByRole("button", { name: "Search" }));
  await user.type(screen.getByRole("combobox"), text);
}

describe("CommandPalette", () => {
  it("shows only 'Searching…' while the search is in flight", async () => {
    let finish: (results: PaletteResults) => void = () => {};
    const search = vi.fn(() => new Promise<PaletteResults>((resolve) => (finish = resolve)));
    await openAndType(search, "zzzz");

    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();

    await act(async () => finish(none));
    expect(await screen.findByText("Nothing matches “zzzz”.")).toBeInTheDocument();
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
  });

  it("says so when the search fails, instead of 'Nothing matches'", async () => {
    const search = vi.fn(() => Promise.reject(new Error("offline")));
    await openAndType(search, "ana");

    expect(await screen.findByText(/Search didn’t work/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  });
});
