# Initiate refunds through the audited Operator boundary

Normal Operator-initiated refunds begin in Ask Siargao's same-origin browser workflow with an
allowlisted Operator, fresh MFA, preview confirmation, an idempotency key, and an audit receipt. The
deployed server calls the Payment Authority, but access changes only after verified refund facts are
durably applied. Direct provider-dashboard refunds are reserved for emergency or provider-initiated
cases and must converge through a verified event or read-only Commerce Reconciliation; neither path
permits manual commerce or access database edits.
