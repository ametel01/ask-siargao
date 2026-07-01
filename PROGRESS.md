# Model-Owned Chat Routing Progress

Source plan: `PLAN.md`
Source brief: inline prompt supplied in this chat on 2026-07-01.

## Current Status

- Status: Step 0 complete
- Current step: Step 1 - Fix Web Research Structured Output Schema
- Next step: Step 1 - Fix Web Research Structured Output Schema

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [ ] Step 1: Fix Web Research Structured Output Schema
- [ ] Step 2: Add Behavioral Regression Tests for Model-Owned Routing
- [ ] Step 3: Trim Route-Level Deterministic Signals
- [ ] Step 4: Remove Route-Derived Required Evidence Planning
- [ ] Step 5: Remove Auto-Injected Required Evidence Repairs From Route Classifiers
- [ ] Step 6: Make Provider Failures Non-Terminal
- [ ] Step 7: Strengthen Model Tool-Choice Instructions
- [ ] Step 8: Preserve and Extend Source Validation
- [ ] Step 9: Remove or Quarantine Brittle Classifier Tests and Dead Routing Helpers
- [ ] Step 10: Documentation, Final Gates, and Handoff

## Update Rule

Update this file after every completed step with:

- completed step and summary;
- validation commands and results;
- commit reference if available;
- current status;
- next step.

## Update Log

### 2026-07-01 - Step 0 Started

- Replaced the previous completed web-research implementation progress tracker with the active
  model-owned chat routing plan checklist from `PLAN.md`.
- Preserved the required update rule so progress, validation, and commit references are recorded
  after every completed step.
- Next action: validate `PROGRESS.md` and `CHANGELOG.md`, run Step 0 gates, update this entry with
  results, and commit Step 0.

### 2026-07-01 - Step 0 Completed

- Created current progress tracking for the model-owned chat routing implementation plan and kept
  `CHANGELOG.md` under `## [Unreleased]` updated for the tracking setup.
- Validation passed:
  - `test -f PROGRESS.md`
  - `test -f CHANGELOG.md`
  - `rg -n "Model-Owned Chat Routing|Step 0|Step 1" PROGRESS.md`
  - `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 702 tests passed
- Commit reference: this commit (`Track model-owned chat routing plan progress`).
- Next step: Step 1 - Fix Web Research Structured Output Schema.
