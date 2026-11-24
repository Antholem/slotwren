"use client";

import { Check, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { answerQuestionAction } from "./actions";

/** "Mark answered" on a question for the team (owners). */
export function MarkAnsweredButton({ questionId }: { questionId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      className="h-11 w-fit border px-5 text-label"
      onClick={() =>
        start(async () => {
          const result = await answerQuestionAction(questionId);
          if (result.ok) toast.success("Marked as answered");
          else toast.error(result.error.message);
        })
      }
    >
      {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
      Mark answered
    </Button>
  );
}
