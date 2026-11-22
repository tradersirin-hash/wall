# Wall privacy policy

Effective 22 November 2026.

Wall is a Forge app for Jira Cloud. It keeps confidential ("walled") Jira projects walled: it shows who can see a walled project and who can change that, and it keeps a hash-chained ledger of every crossing. This policy says what data Wall handles, where it is kept, and how to remove it.

## Where the data lives

Wall runs entirely on Atlassian's Forge platform, inside the Atlassian site that installs it. It stores data only in Forge's hosted storage for that site (Forge SQL and the Forge key-value store). Wall makes no outbound calls: no data is sent to the developer or to any third party, and there is no analytics or tracking. The developer cannot read the data a site stores in Wall.

## What Wall stores

- **Walls:** the Jira project id and key of each walled project, the description of the inside information and the code name an admin types when raising the wall, and the wall's status and dates.
- **The crossing ledger:** one record per event (wall raised, crossing granted, acknowledged, extended, ended, unrecorded access flagged). A record names people only by their Atlassian account id, and holds the times, the access route (for example a project role or group name), the reason and function an admin typed, the approver's account id, and SHA-256 hashes that chain the records together.
- **Scan summaries:** the time of each check, counts (how many people can see the project, how many can change that) and hashes of the scan, with no names.
- **Settings:** Wall's own app account id, the latest ledger head for each wall, and the storage schema version.

Wall does not store names, email addresses or phone numbers. Display names are read from Jira when a page is shown and are not kept. A planned insider-list export may let admins enter names and professional phone numbers for the export; this policy will be updated before that ships, and those details will be kept apart from the ledger so they can be deleted person by person.

## What Wall reads but does not store

To work out who can see a project, Wall reads the project's permission scheme, project roles, group memberships, Jira's own list of users who can browse the project, Jira's permission check for "Administer Jira", and Jira's audit log (to say who made an access change). The app requests read access to Atlassian's Teamwork Graph for an engagement-evidence view. That view reads activity as the signed-in user and does not store it.

## Who can see it

Only Jira admins of the site can open Wall's pages: every request checks that the caller has the "Administer Jira" permission. The admin who installs Wall, and the organization that owns the site, control the data.

## Retention and deletion

- The ledger is append-only by design: records are added, never edited, so the history stays verifiable. It is kept for as long as the wall exists.
- An admin can delete a wall from its page ("Delete this wall"). Deleting a wall permanently removes the wall, its whole ledger and its scan summaries. Nobody's access in Jira changes. Export what you must keep first.
- When Wall is uninstalled from a site, Atlassian's Forge platform removes the app's stored data for that site under Atlassian's retention rules for app storage.
- Forge keeps app logs that the developer can see for troubleshooting. Wall writes project keys, wall ids, record counts and error messages there, never ledger contents or names.

Requests about a person's data (access or deletion) should go to the admins of the Jira site that uses Wall, because they control it. The developer will help them if asked.

## Not legal advice

Wall helps keep records of who has access to a confidential project. It is not legal advice, and using it does not by itself make anyone compliant with any law or regulation, including the EU Market Abuse Regulation.

## Changes and contact

Changes to this policy are published in this file with a new effective date.

Contact: tradersirin@gmail.com
