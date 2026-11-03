import { Logo } from "@/components/shared/logo";
import { SignOutButton } from "@/components/shared/sign-out-button";

/** Top bar for full-page signed-in flows (onboarding): logo left, sign-out right. */
export function SignedInTopBar() {
  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4 sm:px-8">
      <Logo />
      <SignOutButton />
    </header>
  );
}
