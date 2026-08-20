"use client";

import { useReverification } from "@clerk/nextjs";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appBodyClass, appCardClass } from "@/ui/components/ask-siargao";

type RefundPreview = {
  after: Record<string, unknown>;
  before: Record<string, unknown>;
  decision: "full_refund" | "accept_partial_refund";
  digest: string;
  orderId: string;
};

type PreparedRefund = {
  idempotencyKey: string;
  preview: RefundPreview;
};

export function OperatorRefundPanel() {
  const [orderId, setOrderId] = useState("");
  const [decision, setDecision] = useState<RefundPreview["decision"]>("full_refund");
  const [preparedRefund, setPreparedRefund] = useState<PreparedRefund | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const executeWithFreshMfa = useReverification(async (prepared: PreparedRefund) =>
    fetch("/api/admin/trip-pass/refunds", {
      body: JSON.stringify({
        confirmation: "APPLY REFUND",
        decision: prepared.preview.decision,
        idempotencyKey: prepared.idempotencyKey,
        mode: "execute",
        orderId: prepared.preview.orderId,
        previewDigest: prepared.preview.digest,
        reasonCode: "operator_requested_refund",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

  async function requestPreview() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/trip-pass/refunds", {
        body: JSON.stringify({ decision, mode: "preview", orderId: orderId.trim() }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as { error?: string; preview?: RefundPreview };
      if (!response.ok || !body.preview) throw new Error(body.error ?? "preview_failed");
      setPreparedRefund({ idempotencyKey: crypto.randomUUID(), preview: body.preview });
    } catch (error) {
      setPreparedRefund(null);
      setMessage(error instanceof Error ? error.message : "preview_failed");
    } finally {
      setPending(false);
    }
  }

  async function executeRefund() {
    if (!preparedRefund) return;
    setPending(true);
    setMessage("");
    try {
      const response = await executeWithFreshMfa(preparedRefund);
      if (!response) throw new Error("fresh_mfa_required");
      const body = (await response.json()) as { error?: string; result?: { status?: string } };
      if (!response.ok) throw new Error(body.error ?? "refund_failed");
      setMessage(
        body.result?.status === "applied" ? "Operator decision recorded." : "Request replayed.",
      );
      setPreparedRefund(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "refund_failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`space-y-4 ${appCardClass}`}>
      <p className={appBodyClass}>
        Preview a full Lemon Squeezy refund or conclude a partial-refund review. Execution requires
        a fresh second-factor verification and is recorded in the Operator audit ledger.
      </p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto]">
        <Input
          aria-label="Trip Pass Order ID"
          onChange={(event) => {
            setOrderId(event.target.value);
            setPreparedRefund(null);
          }}
          placeholder="trip_pass_order_…"
          value={orderId}
        />
        <select
          aria-label="Refund decision"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          onChange={(event) => {
            setDecision(event.target.value as RefundPreview["decision"]);
            setPreparedRefund(null);
          }}
          value={decision}
        >
          <option value="full_refund">Queue full refund</option>
          <option value="accept_partial_refund">Accept partial refund</option>
        </select>
        <Button
          disabled={pending || orderId.trim().length === 0}
          onClick={requestPreview}
          type="button"
        >
          Preview
        </Button>
      </div>
      {preparedRefund ? (
        <div className="space-y-3 rounded-md border border-border-default p-4">
          <p className={appBodyClass}>
            Before: {JSON.stringify(preparedRefund.preview.before)}
            <br />
            After: {JSON.stringify(preparedRefund.preview.after)}
          </p>
          <Button disabled={pending} onClick={executeRefund} type="button" variant="destructive">
            Confirm with fresh MFA
          </Button>
        </div>
      ) : null}
      {message ? <p className={appBodyClass}>{message}</p> : null}
    </div>
  );
}
