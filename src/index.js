// Wall: Forge entry points. This file wires the platform (Jira REST, Forge SQL,
// the key-value store) into the service; everything else is plain code under
// src/engine and src/server.
//
// Jira is read as the app, so the admin page, the scheduled check and Rovo all see
// the same thing. Every resolver first checks that the caller is a Jira admin.

import ResolverExport from '@forge/resolver';
import { asApp, asUser, assumeTrustedRoute } from '@forge/api';
import { migrationRunner, sql } from '@forge/sql';
import { kvs } from '@forge/kvs';
import { Queue } from '@forge/events';
import { JiraError, createJira } from './server/jira.js';
import { MIGRATIONS } from './server/schema.js';
import { createSqlStore } from './server/store.js';
import { WallError, createWallService } from './server/walls.js';
import { LedgerError } from './engine/index.js';

// This package is an ES module, so a default import of a CommonJS package (such as
// @forge/resolver) gives its whole exports object; take the class from it either way.
const Resolver = ResolverExport.default ?? ResolverExport;

const SCHEMA_KEY = 'wall-schema-version';
const APP_ACCOUNT_KEY = 'wall-app-account';
const migrations = new Queue({ key: 'wall-migrations' });

const now = () => new Date().toISOString();
const requester = (as) => (path, init) => (as === 'user' ? asUser() : asApp()).requestJira(assumeTrustedRoute(path), init);
const appJira = createJira(requester('app'));
const userJira = createJira(requester('user'));
const store = createSqlStore({
  exec: async (query, params) => (await sql.prepare(query).bindParams(...params).execute()).rows,
  kv: kvs,
});

let appAccount = null;
async function appAccountId() {
  if (appAccount) return appAccount;
  appAccount = (await kvs.get(APP_ACCOUNT_KEY)) ?? null;
  if (!appAccount) {
    const me = await appJira.get('/rest/api/3/myself');
    if (me?.accountType === 'app') {
      appAccount = me.accountId;
      await kvs.set(APP_ACCOUNT_KEY, appAccount);
    }
  }
  return appAccount;
}

const service = createWallService({ jira: appJira, store, now, appAccountId });

async function runMigrationsNow() {
  let runner = migrationRunner;
  for (const [name, ddl] of MIGRATIONS) runner = runner.enqueue(name, ddl);
  const ran = await runner.run();
  await kvs.set(SCHEMA_KEY, MIGRATIONS.length);
  return ran;
}

async function ensureSchema() {
  if ((await kvs.get(SCHEMA_KEY)) === MIGRATIONS.length) return;
  await runMigrationsNow();
}

async function requireAdmin(context) {
  const answer = await userJira.get(`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!answer?.permissions?.ADMINISTER?.havePermission) {
    throw new WallError('not-admin', 'Only Jira admins can use Wall.');
  }
  return context.accountId;
}

function failure(error) {
  if (error instanceof WallError || error instanceof LedgerError) return { error: { code: error.code, message: error.message } };
  if (error instanceof JiraError) return { error: { code: `jira-${error.status}`, message: error.message } };
  console.error('Wall resolver failed', error);
  return { error: { code: 'unexpected', message: 'Something went wrong. Try again; if it persists, check the app logs.' } };
}

/** Wrap a resolver: schema, admin check, and errors returned as data the page can show. */
const guarded = (fn) => async ({ payload, context }) => {
  try {
    await ensureSchema();
    const by = await requireAdmin(context);
    return { data: await fn(payload ?? {}, by) };
  } catch (error) {
    return failure(error);
  }
};

const resolver = new Resolver();
resolver.define('whoAmI', guarded(async (_payload, by) => ({ accountId: by, appAccountId: await appAccountId() })));
resolver.define('candidateProjects', guarded(() => service.candidateProjects()));
resolver.define('listWalls', guarded(() => service.listWalls()));
resolver.define('raiseWall', guarded((p, by) => service.raiseWall({ projectKey: p.projectKey, subject: p.subject, codeName: p.codeName, identifiedAt: p.identifiedAt, by })));
resolver.define('wallView', guarded((p, by) => service.wallView(p.wallId, { by })));
resolver.define('deleteWall', guarded(async (p, by) => {
  const result = await service.deleteWall(p.wallId, { confirmKey: p.confirmKey, by });
  console.log(`Wall deleted: ${result.projectKey} (${result.recordsDeleted} records)`);
  return result;
}));

export const handler = resolver.getDefinitions();

/** Scheduled trigger: check every wall and flag new unrecorded crossings. */
export async function driftScan() {
  await ensureSchema();
  const results = await service.checkWalls();
  console.log(`Wall drift scan: ${JSON.stringify(results)}`);
}

/** Lifecycle trigger (installed, upgraded): queue the migrations. */
export async function enqueueMigrations(event) {
  await migrations.push({ body: { reason: event?.eventType ?? 'lifecycle' } });
}

/** Queue consumer: run the migrations. */
export async function runMigrations() {
  const ran = await runMigrationsNow();
  console.log(`Wall migrations run: ${JSON.stringify(ran)}`);
}
