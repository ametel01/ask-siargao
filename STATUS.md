# Field Workspace completion status

The aggregate implementation has passed candidate-local automated validation,
but #244 is not accepted for release.

## Administrative blocker

- PR #247 is authored by `ametel01`, remains draft, and has no eligible
  non-author maintainer approval.
- Next action: an eligible non-author maintainer must be requested as the formal
  approver and must submit an `APPROVED` review. Automated checker evidence and
  same-author comments do not satisfy that gate.

## Evidence still required

- Clean-device planning requires the deployment-only
  `FIELD_PLANNER_INITIAL_HANDOFF_JSON` preseed to be generated from the approved
  protocol/preflight authority and configured before first use. The authenticated
  `/api/operator/field/planning/handoff` route now serves that machine-generated handoff; it
  remains fail-closed when the deployment variable is absent, malformed, stale, or
  protocol-mismatched, and the Recorder persists an accepted handoff into encrypted local custody.
  This is an operational pre-seeding handoff, not a browser JSON authoring surface.
- Attended execution of the built-in first-use camera/scan, time/timezone, encrypted sample,
  recovery restore, and challenged offline-reload checks on a real iPad.
- Attended iPad and Mac migration, Files/AirDrop transfer, interruption resume, destination
  decryption/reference verification, signed receipt return and source acceptance, recovery restore,
  rollback, restart, VoiceOver, touch, and dictation evidence.
- Independent checker evidence and exact production deployment/provider
  acceptance for the protected Field Workspace.
- Product-owner/accountable-editor acceptance of the final Field Workspace
  contract.

Until those gates are supplied, keep PR #247 and issues #237-#244 open and
fail closed on release claims.
