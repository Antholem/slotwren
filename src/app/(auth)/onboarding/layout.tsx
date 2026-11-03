import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Set up your business",
};

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return <div className="flex flex-1 flex-col bg-background">{children}</div>;
}
