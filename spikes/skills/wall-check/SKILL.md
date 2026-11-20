---
name: wall-check
description: Check who can see a Jira project before sharing its work or assigning someone to it. Use when a user asks whether a person may see a project, or before an agent shares or assigns work in a confidential project.
allowed-tools: wall-spike-check
---

# Wall check (spike version)

This is the week-1 spike of the `wall-check` skill. It only proves that the skill loads and can call its tool.

## Steps

1. Find the Jira project key in the request (for example FALCON). If there is none, ask for it.
2. Call `wall-spike-check` with `projectKey`.
3. Report the permission scheme name and how many grants give "Browse projects".
4. If the tool returns an error, show its status and message as they are; do not guess.

The full skill will answer "may this person see this walled project?" from Wall's ledger, and say whether a crossing is recorded.
