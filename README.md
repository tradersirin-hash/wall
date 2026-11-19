# Wall

**A need-to-know ledger for confidential Jira projects.** (Working name.)

Some projects must stay behind a wall: a merger, a takeover, an unannounced result, a sensitive investigation. Regulated companies are expected to know, at any moment, who has access to such a project, since when and why. In Jira, access is spread across permission schemes, roles and groups, and anyone who can change who sees a project can quietly add themselves.

Wall is a Forge app for Jira that:

1. **Separates two tiers** per walled project: people who can see it, and people who can change who sees it.
2. **Records every crossing** in an append-only, hash-chained ledger: who was brought over the wall, by which path (group, role, direct grant), why, who approved it, and when they acknowledged it. Crossings can expire.
3. **Catches drift**: when someone gains access without a recorded crossing, Wall names who made the change from Jira's audit log.
4. **Shows engagement evidence** from the Teamwork Graph: who actually contributed to, was shared on or was mentioned in the project's work.
5. **Exports** the list in a regulator-style insider-list layout, leaving personal-identifier columns blank for offline entry; Wall stores no personal ID numbers.

A Rovo agent answers "who has known about this project, since when, and why?" and handles "bring this person over the wall until 30 January". A reusable `wall-check` skill lets other agents ask before they share or assign work.

## Status

Engine and ledger built and tested; Forge app in progress. See [PLAN.md](PLAN.md). Built for Atlassian Codegeist 2026.

```
npm test
```

runs the engine tests (Node 22 or later, no dependencies).

## How it is built

- `src/engine/`: pure functions over a scan of the site, the ledger and audit records; no Jira calls.
  - `tiers.js`: the two tiers of a walled project, openings (anyone, any logged-in user), admins who could admit themselves, shared schemes.
  - `explain.js`: every path by which a person can see a project, as plain sentences.
  - `ledger.js`: the append-only, hash-chained crossing ledger, its rules and its verification.
  - `drift.js` and `attribution.js`: the "can see" set against the ledger, with each unrecorded crossing attributed from Jira's audit log.
  - `export.js`: the insider-list CSV ([docs/insider-list-export.md](docs/insider-list-export.md)) and the evidence CSV.
  - `certificate.js`: SHA-256 certificates binding a scan, the tiers and the ledger head.
  - `lab.js`: the Lab mode plan for a sample walled project.
- `test/`: fixture tests with `node:test`.

## Evidence levels

| Level | Meaning |
|---|---|
| Proven-static | Follows from the scheme, role and group data alone |
| Confirmed-by-Jira | Checked with Jira's permission check |
| Conditional | Depends on the work item (reporter, assignee, user or group fields) |
| Observed | Seen in Teamwork Graph activity |
| Recorded | Written in Wall's ledger |
| Unknown | Not visible to a Forge app (for example organization admins, group managers, product access) |

## The ledger

Every record holds the SHA-256 of its own body and of the record before it. Editing, removing or reordering a record breaks the chain at that point; records cut off the end are caught against the last head Wall saved elsewhere and printed on every export. Before a record is appended it must pass the ledger's rules (for example: only the person who crossed can acknowledge, nobody approves their own crossing, a wall is lowered only after every crossing has ended), and verification replays those rules too. Records name people by Atlassian account id only; names and phone numbers for the export live in a separate store that can be erased.
