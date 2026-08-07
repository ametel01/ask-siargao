import { Sparkles, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { responseWaitStatusText } from "@/features/chat/response-wait-state";

export function PendingAssistantWaitState({
  disabled,
  onStopWaiting,
  statusText = responseWaitStatusText,
}: {
  disabled: boolean;
  onStopWaiting: () => void;
  statusText?: string;
}) {
  return (
    <div aria-busy="true" className="grid min-w-0 gap-3" data-testid="assistant-wait-state">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-brand-violet-200 bg-brand-lavender-50 text-brand-violet-650"
        >
          <Sparkles size={17} />
        </span>
        <p
          aria-atomic="true"
          aria-live="polite"
          className="m-0 min-w-0 text-sm leading-6 font-extrabold text-text-strong"
          data-testid="assistant-wait-status"
          role="status"
        >
          {statusText}
        </p>
      </div>
      <Button
        className="min-h-11 w-fit rounded-md border-border-default bg-white px-3 text-sm font-extrabold text-text-strong hover:bg-brand-lavender-50"
        disabled={disabled}
        onClick={onStopWaiting}
        type="button"
        variant="outline"
      >
        <Square aria-hidden="true" size={13} />
        Stop waiting
      </Button>
    </div>
  );
}
