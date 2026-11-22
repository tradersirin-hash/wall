# Wall

**A need-to-know ledger for confidential Jira projects.**

Some projects must stay behind a wall: a merger, a takeover, an unannounced result, a sensitive investigation. Regulated companies are expected to know, at any moment, who has access to such a project, since when and why. In Jira, access is spread across permission schemes, roles and groups, and anyone who can change who sees a project can quietly add themselves.

Wall is a Forge app for Jira Cloud that:

1. **Separates two tiers** for each walled project: the people who can see it, and the people who can change who sees it. Admins who cannot see the project but could let themselves in are named.
2. **Records every crossing** in an append-only, hash-chained ledger: who was brought over the wall, by which route (role, group, grant), why, who approved it, and when they acknowledged it.
3. **Catches drift:** when someone gains access without a recorded crossing, Wall flags it and names who made the change, from Jira's audit log.
4. **Checks itself against Jira:** every person Wall lists is compared with Jira's own list of who can browse the project, and admin rights are confirmed with Jira's permission check.

Wall runs entirely on Atlassian's Forge platform and makes no outbound calls. Built for Atlassian Codegeist 2026.

## Try it

**Install:** [Install Wall on your Jira site](https://developer.atlassian.com/console/install/2cd259ce-455b-4572-a4c7-2aad263b1402?signature=AYABeLRFsMersZ2%2FVxxz3Fv20RkAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucBkog6bliUSpPA9kLyiRBOwQAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDAGDXTLwVbq6ksSxZgIBEIA7k4dmdaCYPk5B3gMzyOwStJc1BYBOajFNSlC9kDBm7NZZgoVtjJhj2mA4m2LDWq2a1JcpQnaBp35IkRMAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFMl4OcqJHgaPWeQxD5ZcQ9AAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMYqq72yChvoiKfRRKAgEQgDuLEZrTccKmvThODDJ9GwxsNUTsWhxzSvS8c0uqT52H7YaK4knC5eFIK35XajJJf8ajpimZbfT1lVBC%2FgAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATykaysY9IZ6pxgo1ZAdQ6cAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAwQaprsqQWof5rAELkCARCAO81zZ%2Bt10JpDPqkcxcEvRLFkMqnYDmIswceXF2LsjBatOZ3MMEkOLuaXCWqRiWPyZEO%2BN8esFUdkZ9NIAgAAAAAMAAAQAAAAAAAAAAAAAAAAAAvFxkDpVLfBAGB6Gw2B9Kf%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADL1glVD4yrDzFiDicmgVgXj2V8nmhlJ5%2FTF4jwSGd1RuHstoRlmC5EVZADOawoFEtMteMKwdCQf5eJg4FdgMIWbKQA%3D&product=jira). Open it as an admin of a Jira Cloud site and approve the requested access. Installing an app that reads the Teamwork Graph needs an organization admin. If the first attempt says "An unexpected error occurred", try once more.

**Five-minute tour:**

1. In Jira, open **Settings (gear) > Marketplace apps** ("Apps" on some sites), then **Wall** in the left sidebar.
2. Click **Raise a wall**, choose a company-managed project (a new site often has only a team-managed one; create one with **Projects > Create project**, pick a template such as Kanban, and choose **Company-managed** on the project type step), describe the inside information it holds (for example "Proposed acquisition, test data") and raise the wall. Everyone who can see the project now is recorded as a baseline crossing.
3. Read the four tabs:
   - **Who can see:** each person, the route that lets them in, how Wall knows it ("From the scheme", "Confirmed by Jira"), and their crossing. A red box appears if the scheme lets in a whole class of people, such as any logged-in user.
   - **Who can change it:** Jira admins, project admins, and the parts no app can see (organization admins, group managers). The amber box names admins who could let themselves in.
   - **Drift:** people who can see the project without a recorded crossing, each with the change that let them in and who made it.
   - **Ledger:** every crossing and every record, with the chain verified and checked against the last head Wall saved.
4. **The live moment:** in a project whose scheme grants Browse only through roles, open **Project settings > People**, add yourself to a role, then click **Check now** in Wall. The Drift tab shows you as an unrecorded crossing: "*You* added themselves to role … on … UTC".

**Remove:** **Delete this wall** at the bottom of a wall's page removes the wall and its whole ledger; Jira access does not change.

## Status

Working now: raising a wall, both tiers, the ledger with verification, drift with audit-log attribution, the hourly check that writes new drift into the ledger, and deleting a wall.

Coming next: the crossing workflow (request, approve, grant through Wall's role, acknowledge in the work item panel, expire and remove), recording a crossing after the fact from the Drift tab, Lab mode (a sample walled project with a believable history on an empty site), Teamwork Graph engagement evidence, the insider-list export, and a Rovo agent with a reusable `wall-check` skill.

## Privacy and terms

What Wall stores and how to delete it: [PRIVACY.md](PRIVACY.md). Terms: [TERMS.md](TERMS.md). Wall helps keep records; it does not by itself make anyone compliant with any law or regulation.

## Evidence levels

| Level | Meaning |
|---|---|
| Proven-static | Follows from the scheme, role and group data alone |
| Confirmed-by-Jira | Checked with Jira's own list or its permission check |
| Conditional | Depends on the work item (reporter, assignee, user or group fields) |
| Observed | Seen in Teamwork Graph activity |
| Recorded | Written in Wall's ledger |
| Unknown | Not visible to a Forge app (for example organization admins, group managers, product access) |

## The ledger

Every record holds the SHA-256 of its own body and of the record before it. Editing, removing or reordering a record breaks the chain at that point; records cut off the end are caught against the last head Wall saved elsewhere. Before a record is appended it must pass the ledger's rules (only the person who crossed can acknowledge, nobody approves their own crossing, a wall is lowered only after every crossing has ended), and verification replays those rules too. Records name people by Atlassian account id only.

## Development

```
npm test
```

runs the tests (Node 22 or later). The app itself needs the Forge CLI and Node 24.22 or later.

- `src/engine/`: pure functions over a scan of the site, the ledger and audit records; no Jira calls.
  - `tiers.js` the two tiers; `explain.js` every access path as a sentence; `ledger.js` the hash-chained ledger and its rules; `drift.js` and `attribution.js` drift and who caused it; `export.js` the insider-list layout ([docs/insider-list-export.md](docs/insider-list-export.md)); `certificate.js` SHA-256 certificates; `lab.js` the Lab mode plan.
- `src/server/`: the Jira scan, storage (Forge SQL and the key-value store), audit-log reading and the wall service, with Jira and storage injected so they run in tests.
- `src/index.js`: Forge entry points; `src/frontend/admin.jsx`: the admin page (UI Kit).
- `spikes/`: the throwaway app that answered the platform questions before the build ([spikes/README.md](spikes/README.md)).
- `test/`: `node:test` tests against fixtures and a fake Jira site.

Licensed under the [Apache License 2.0](LICENSE).
