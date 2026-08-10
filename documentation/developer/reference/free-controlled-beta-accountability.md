# Free Controlled Beta Accountability

This reference records the current accountable people and approved spending limits for preparing
Ask Siargao's Free Controlled Beta. It is a baseline for the dedicated free-release GitHub issue and
does not itself grant Launch Authorization.

## Accountable people

| Responsibility | Owner | Status |
| --- | --- | --- |
| Operator | Alex Metelli | Assigned for the Staffed Exposure Window. |
| Evidence Owner | Alex Metelli | Assigned to assemble and attest exact-candidate Release Evidence. |
| Launch Approver | `UNASSIGNED` | Administrative blocker: the approver must be an eligible non-author human and cannot be Alex Metelli while he is the candidate author, Evidence Owner, and Operator. |
| Rollback owner | Alex Metelli | Assigned to exercise and execute application rollback. |
| Security and privacy incident owner | Alex Metelli | Assigned to close exposure and coordinate incident response. |
| Cost owner | Alex Metelli | Assigned to monitor provider and infrastructure spend and enforce the approved stops. |

Role concentration is accepted for beta preparation because Ask Siargao is currently operated by one
developer. It does not create 24/7 coverage and does not remove the independent Launch Approver
requirement.

## Approved limits

| Limit | Approved value | Enforcement boundary |
| --- | --- | --- |
| Recurring infrastructure commitments | USD 200 per month | Plan changes above this amount require explicit approval. |
| Total fixed-infrastructure ceiling | USD 300 per month | Reserve USD 100 for usage growth or emergency scaling; alert at 70 and 90 percent. |
| Daily model and provider ceiling | USD 25 per UTC day | Allocate USD 10 to model calls and USD 15 to Google Places; alert at 70 percent and stop new paid provider work at 100 percent. |

The Free Controlled Beta additionally retains the existing traffic limits of 100 new Ask Siargao
Accounts and 1,000 Travel Answers per day.

## Administrative blocker

Alex Metelli cannot authorize his own release under the current launch contract. Before requesting
Launch Authorization, recruit one trusted non-author human who can review the exact-candidate Release
Evidence, residual risks, rollback and restore results, alert evidence, and provider configuration.
Record that person's identity and decision in the dedicated free-release GitHub issue. A same-author
comment or self-approval does not close this blocker.
