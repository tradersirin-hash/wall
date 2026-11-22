# Wall spike: week-1 checklist

A throwaway Forge app that answered Wall's three go/no-go platform questions on a Forge demo site before the build. It is registered as its own app, deployed to the development environment only, and deleted afterwards. Its scopes are the candidate set for the real app, so the deploy also tests them.

| Spike | Question | Check in this app |
|---|---|---|
| 1 | Does the Teamwork Graph return other users' edges (contributed, shared with, mentioned, team) for an admin caller? | "Run all" (graph part), the raw query box, persisted queries |
| 2 | Can the app manage project role members as the app? | "Writes": add the target to a role and remove it, as the app and then as you |
| 3 | Does the audit log record role and group changes with the actor? | "Read audit log" after the writes and after the manual changes below |

The page also checks the reads the scheduled drift scan needs as the app (permission scheme, grants, roles, group members, users with Browse, Jira admin check for another account), and the Rovo agent, action and `wall-check` skill.

## 1. Before you start

- Node 24.22.1 or later on the 24 line (`node --version`); the Forge CLI 15.0.0 needs `^22.23.4 || ^24.22.1 || >=26.12.1`.
- An Atlassian account, an API token, and the Forge demo site with Rovo.
- On the demo site, as admin:
  - a company-managed test project, for example `WALLTEST`;
  - a project role you are **not** in for that project (the test adds you and removes you again; it refuses to touch a role you are already in);
  - optionally a group you are not in, to test group writes.

## 2. Install, sign in, deploy (from this `spikes` folder)

`.npmrc` here turns install scripts off and saves exact versions. Install only versions published at least two weeks ago, including transitive ones (replace the date with today minus 14 days):

```
npm install --before=2026-11-06
```

Signing in: `@forge/cli` stores credentials with `keytar`, whose native build is an install script, so with scripts off `forge login` may fail to save them. If it does, set the two variables Forge reads instead (they take precedence over `forge login`), in the current PowerShell window only:

```
$env:FORGE_EMAIL = "<account email>"
$env:FORGE_API_TOKEN = "<API token>"
```

If another program called `forge` is on the PATH (Foundry, for example), call the Atlassian CLI through the local install:

```
npx --no-install forge --version
npx --no-install forge register
npx --no-install forge lint
npx --no-install forge deploy -e development
npx --no-install forge install -e development --product jira --site <demo-site>.atlassian.net
```

`forge register` asks for a name (use `wall-spike`) and writes the app id into `manifest.yml`. Installing an app with Teamwork Graph scopes needs an organization admin; on the demo site that is you.

Open Jira, then Settings, Apps, and "Wall spike" in the sidebar.

## 3. Run the checks

1. Type the test project key and click **Reads**. The result lists the project's roles with their ids (the last number in each URL) and the groups that grant Browse.
2. Fill the role id (a role you are not in), optionally a group id, then click **Run all**. It runs identity, reads, writes (add and remove, as app then as you) and the Teamwork Graph checks.
3. Make these changes by hand and note the time before the first one:
   1. Project settings, People: add yourself to the test role, then remove yourself. (This is the demo's live moment.)
   2. admin.atlassian.com: add a user to a group, then remove them.
   3. Settings, Work items, Permission schemes: on a copy of the test project's scheme, add a "Browse projects" grant for a group; then switch the test project to that copy and back.
4. Wait about a minute, put the noted time in "Audit log from", and click **Read audit log**.
5. Rovo: open Rovo chat, choose the "Wall spike" agent and ask "Which permission scheme does project WALLTEST use?". The action should answer with the scheme and the number of Browse grants. Check that the `wall-check` skill is listed.
6. Teamwork Graph, persisted Cypher (optional but needed for a full GO on spike 1): register the queries below in TWG Labs while signed in as an app contributor, wait a minute, paste their keys into the box as JSON, and click **Run all** again.
7. Logs, without the browser: `npx --no-install forge logs -e development` shows one `WALL-SPIKE` line per check.

Save the Report block as `spikes/results/<date>.json`. That folder is ignored by git: it holds real account ids.

### Persisted Cypher queries (for TWG Labs)

Relationship names marked [doc] are in Atlassian's relationship reference; [inferred] ones follow its naming pattern and are part of what the spike tests.

| Name | Cypher | Parameter |
|---|---|---|
| `wall_user_contributed` [doc] | `MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_contributed_to_jira_work_item]->(item:JiraWorkItem) RETURN item` | `id`: user ARI |
| `wall_item_shared_with` [doc] | `MATCH (item:JiraWorkItem {ari: $id})-[:jira_work_item_shared_with_atlassian_user]->(user:AtlassianUser) RETURN user` | `id`: work item ARI |
| `wall_user_mentioned` [inferred] | `MATCH (user:AtlassianUser {ari: $id})-[:atlassian_user_mentioned_in_jira_work_item]->(item:JiraWorkItem) RETURN item` | `id`: user ARI |
| `wall_project_contributors` [inferred] | `MATCH (space:JiraSpace {ari: $id})-[:jira_space_has_jira_work_item]->(item:JiraWorkItem)<-[:atlassian_user_contributed_to_jira_work_item]-(user:AtlassianUser) RETURN DISTINCT user` | `id`: project ARI |

ARIs: user `ari:cloud:identity::user/<accountId>`, project `ari:cloud:jira:<cloudId>:project/<projectId>`, work item `ari:cloud:jira:<cloudId>:issue/<issueId>`. The identity check shows the cloud id; the reads check shows the project id.

Box format: `[{"queryKey": "<key>", "params": {"id": "ari:cloud:identity::user/<accountId>"}}]`

## 4. Go / no-go

| Spike | GO | PARTIAL | NO-GO, and what Wall does then |
|---|---|---|---|
| 1 | Persisted queries return other users' contributed, shared-with or mentioned edges | Only curated queries return rows (teams, work items, assignees) | Nothing comes back: Teamwork Graph is used for team and owner context only |
| 2 | The app adds and removes a role member, and the role is restored | Only the signed-in admin can (Wall grants as the approving admin, from the admin page) | Neither works: guided admin steps |
| 3 | The role change from step 3.1 is in the audit log with the author's account id | The record exists without an author | No record: pivot to the backup idea "Contain" |

Already known from the docs, to confirm: group changes made in admin.atlassian.com reach Jira's audit log with the author shown as "JIRA", so Wall can time them but not name who made them. Teamwork Graph works only as the signed-in user, so the scheduled scan cannot use it.

## 5. Results (21–22 November 2026)

All three were GO. The Teamwork Graph returned work items, assignments, teams and contributed edges for live activity (new activity appeared within 7 to 10 minutes; the seeded demo projects have no work-item edges). The app account added and removed project role members; group membership works only as the signed-in admin (the app gets 403). Jira's audit log names the author of role and scheme changes; group changes made in Atlassian Administration have no author. The Rovo agent, action and skill loaded.

## 6. Afterwards

- Copy the real audit-record shapes into `test/fixtures/audit.js` with invented account ids, and update `AUDIT_RULES` in `src/engine/attribution.js`.
- Record the verdicts and the scope decision.
- `npx --no-install forge uninstall`, then delete the app in the developer console.
