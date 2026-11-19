// "Why can X see project P?": every path from an account to a permission in a
// project, as a list of steps and one plain sentence per path.

import { accessInProject, userPrincipal } from './access.js';
import { describeClass, routeOf } from './describe.js';
import { BROWSE, Evidence, indexSnapshot, isAnalysable, permissionLabel, resolveProject } from './model.js';

/**
 * @param {import('./model.js').Snapshot} snapshot
 * @param {{ accountId: string, projectKey: string, permission?: string }} query
 */
export function explainAccess(snapshot, { accountId, projectKey, permission = BROWSE }) {
  const index = indexSnapshot(snapshot);
  const project = resolveProject(index, projectKey);
  const user = index.users.get(accountId);
  const name = user?.displayName ?? accountId;
  const label = permissionLabel(permission, snapshot);
  if (!project) return { found: false, reason: `Project ${projectKey} is not in the snapshot.` };
  if (!isAnalysable(project)) return { found: false, reason: `Project ${project.key} is team-managed; Wall cannot analyse it.` };
  const scheme = index.schemes.get(String(project.schemeId));
  const holders = accessInProject(index, project, permission);
  const own = holders.get(userPrincipal(accountId));
  const paths = (own?.paths ?? []).map((p) => ({ ...p, route: routeOf(p), sentence: sentenceFor(name, label, project, p) }));

  // Holders that may include this account but that Wall cannot resolve to a person.
  const others = [];
  for (const [principal, entry] of holders) {
    if (principal.startsWith('user:')) continue;
    for (const p of entry.paths) {
      others.push({
        principal,
        evidence: p.evidence,
        steps: p.steps,
        sentence: `${name} can ${quote(label)} in ${project.key} if they are ${lower(describeClass(principal))}, through scheme ${quote(scheme?.name ?? project.schemeId)}.`,
      });
    }
  }

  let answer = 'no';
  if (own) answer = 'yes';
  else if (others.length) answer = 'depends';
  const evidence = own ? own.evidence : others.length ? weakestClassEvidence(others) : null;

  return {
    found: true,
    answer,
    evidence,
    accountId,
    displayName: name,
    inactive: user?.active === false,
    projectKey: project.key,
    permission,
    permissionLabel: label,
    schemeId: scheme ? String(scheme.id) : null,
    schemeName: scheme?.name ?? null,
    paths,
    conditionalPaths: others,
    summary: summaryFor(answer, name, label, project.key, paths.length, user),
  };
}

function weakestClassEvidence(others) {
  return others.some((o) => o.evidence === Evidence.CONDITIONAL) ? Evidence.CONDITIONAL : Evidence.UNKNOWN;
}

function quote(s) {
  return `"${s}"`;
}

function lower(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function summaryFor(answer, name, label, projectKey, count, user) {
  const inactive = user?.active === false ? ' The account is inactive, so it cannot sign in now.' : '';
  if (answer === 'yes') {
    const ways = count === 1 ? 'one path' : `${count} paths`;
    return `${name} can ${quote(label)} in ${projectKey} through ${ways}.${inactive}`;
  }
  if (answer === 'depends') {
    return `${name} has no personal path to ${quote(label)} in ${projectKey}; it depends on the work item or on product access.${inactive}`;
  }
  return `${name} cannot ${quote(label)} in ${projectKey}.${inactive}`;
}

/** One sentence per path, for example: Bea can "Browse projects" in FALCON because Bea is in role "Walled" ... */
export function sentenceFor(name, label, project, path) {
  const parts = [];
  let grant = null;
  for (const step of path.steps) {
    switch (step.kind) {
      case 'direct':
        parts.push(`${name} is granted it directly`);
        break;
      case 'member':
        parts.push(`${name} is in group ${quote(step.groupName)}`);
        break;
      case 'role':
        if (step.via === 'group') parts.push(`that group is in project role ${quote(step.roleName)} in ${step.projectKey}`);
        else parts.push(`${name} is in project role ${quote(step.roleName)} in ${step.projectKey}`);
        break;
      case 'lead':
        parts.push(`${name} is the lead of ${step.projectKey}`);
        break;
      case 'grant':
        grant = step;
        break;
      default:
        break;
    }
  }
  const tail = grant ? `, and scheme ${quote(grant.schemeName)} grants it to that ${holderNoun(grant.holderType)}` : '';
  return `${name} can ${quote(label)} in ${project.key} because ${parts.join(', ')}${tail}.`;
}

function holderNoun(type) {
  switch (type) {
    case 'user':
      return 'user';
    case 'group':
      return 'group';
    case 'projectRole':
      return 'role';
    case 'projectLead':
      return 'project lead';
    default:
      return 'holder';
  }
}
