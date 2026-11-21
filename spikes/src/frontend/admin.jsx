// Wall spike: admin page (UI Kit). Runs the checks one by one and shows a verdict
// per spike with the raw answers underneath. Nothing here is part of the shipped app.

import React, { useState } from 'react';
import ForgeReconciler, {
  Button,
  CodeBlock,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Stack,
  Text,
  TextArea,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const FIELDS = [
  ['projectKey', 'Test project key (company-managed)', 'WALLTEST'],
  ['roleId', 'Role id the target is NOT in (from the reads result)', ''],
  ['groupId', 'Group id the target is NOT in (optional)', ''],
  ['accountId', 'Target account id (empty = you)', ''],
  ['otherAccountId', 'Another user with activity, for the graph check (empty = you)', ''],
  ['graphProjectId', 'Project id for the graph check, for example a seeded project with activity (empty = test project)', ''],
  ['auditFrom', 'Audit log from (ISO time; empty = last 2 hours)', ''],
];

const ok = (status) => status >= 200 && status < 300;

function verdicts(report) {
  const out = [];
  const graph = report.graph;
  if (graph) {
    const persistedRows = (graph.persisted ?? []).reduce((n, p) => n + (p.rows || 0), 0);
    const curatedRows = ['teamsBySpace', 'spaceWorkItems', 'userAssignedByAri', 'userInTeams'].reduce((n, k) => n + (graph[k]?.rows || 0), 0);
    const errors = ['teamsBySpace', 'spaceWorkItems', 'userAssignedByAri', 'userInTeams'].flatMap((k) => graph[k]?.errors ?? []);
    let verdict = 'NO-GO';
    if (persistedRows > 0) verdict = 'GO';
    else if (curatedRows > 0) verdict = 'PARTIAL';
    out.push({
      spike: '1. Teamwork Graph edges for an admin caller',
      verdict,
      note: `${curatedRows} curated rows, ${persistedRows} persisted rows, ${errors.length} errors. Empty can also mean a missing scope or no data; read the errors.`,
    });
  }
  const writes = report.writes;
  if (writes) {
    const app = writes.roleAsApp;
    const user = writes.roleAsUser;
    let verdict = 'NOT RUN';
    if (app && !app.skipped) verdict = ok(app.add.status) && app.restored ? 'GO' : user && ok(user.add?.status) ? 'PARTIAL (asUser only)' : 'NO-GO';
    out.push({
      spike: '2. Role management as the app',
      verdict,
      note: app?.skipped ?? `asApp add ${app?.add?.status ?? '-'} / remove ${app?.remove?.status ?? '-'}; asUser add ${user?.add?.status ?? '-'}.`,
    });
  }
  const audit = report.audit;
  if (audit) {
    const roleRecords = (audit.records ?? []).filter((r) => /role/i.test(`${r.summary} ${r.objectItem}`));
    const withAuthor = roleRecords.filter((r) => r.authorAccountId);
    let verdict = 'NO-GO';
    if (withAuthor.length) verdict = 'GO';
    else if (roleRecords.length) verdict = 'PARTIAL (no author)';
    out.push({
      spike: '3. Audit log records role changes with the actor',
      verdict,
      note: `${audit.records?.length ?? 0} records since ${audit.from}; ${roleRecords.length} about roles, ${withAuthor.length} with an author account id. Status app ${audit.status?.app}, user ${audit.status?.user}.`,
    });
  }
  return out;
}

const App = () => {
  const [form, setForm] = useState(Object.fromEntries(FIELDS.map(([k, , d]) => [k, d])));
  const [persisted, setPersisted] = useState('[]');
  const [report, setReport] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [rawQuery, setRawQuery] = useState('query wall_schema { __type(name: "JiraWorkItem") { fields { name } } }');
  const [rawVariables, setRawVariables] = useState('{}');

  // Functional updates: UI Kit sends change events asynchronously, and a stale copy of the form drops keystrokes.
  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const run = async (name, step, payload) => {
    setBusy(step);
    setError(null);
    try {
      const result = await invoke(name, payload);
      setReport((r) => ({ ...r, [step]: result }));
      return result;
    } catch (e) {
      setError(`${step}: ${e.message}`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const base = () => ({ projectKey: form.projectKey.trim(), accountId: form.accountId.trim(), groupId: form.groupId.trim() });

  const runAll = async () => {
    await run('checkIdentity', 'identity', {});
    const reads = await run('checkReads', 'reads', base());
    await run('checkWrites', 'writes', { ...base(), roleId: form.roleId.trim() });
    let list = [];
    try {
      list = JSON.parse(persisted || '[]');
    } catch {
      setError('Persisted queries must be a JSON array of {"queryKey": "...", "params": {...}}');
    }
    await run('checkGraph', 'graph', { projectId: form.graphProjectId.trim() || reads?.projectId, otherAccountId: form.otherAccountId.trim(), persisted: list });
  };

  return (
    <Stack space="space.200">
      <Heading as="h2" size="medium">Wall spike</Heading>
      <Text>Run the checks in order. "Run all" reads access data, adds the target to the role (and group) and removes it again, then queries the Teamwork Graph. Wait about a minute, then read the audit log.</Text>
      {FIELDS.map(([key, label]) => (
        <Stack space="space.050" key={key}>
          <Label labelFor={key}>{label}</Label>
          <Textfield id={key} name={key} value={form[key]} onChange={set(key)} />
        </Stack>
      ))}
      <Stack space="space.050">
        <Label labelFor="persisted">Persisted Cypher queries to try (JSON array of queryKey and params)</Label>
        <TextArea id="persisted" name="persisted" value={persisted} onChange={(e) => { const v = e.target.value; setPersisted(() => v); }} />
      </Stack>
      <Inline space="space.100" shouldWrap>
        <Button appearance="primary" isDisabled={Boolean(busy)} onClick={runAll}>Run all</Button>
        <Button isDisabled={Boolean(busy)} onClick={() => run('checkIdentity', 'identity', {})}>Identity</Button>
        <Button isDisabled={Boolean(busy)} onClick={() => run('checkReads', 'reads', base())}>Reads</Button>
        <Button isDisabled={Boolean(busy)} onClick={() => run('checkWrites', 'writes', { ...base(), roleId: form.roleId.trim() })}>Writes</Button>
        <Button isDisabled={Boolean(busy)} onClick={() => run('checkAudit', 'audit', { from: form.auditFrom.trim() || report.writes?.startedAt, raw: true })}>Read audit log</Button>
        <Button isDisabled={Boolean(busy)} onClick={() => run('checkGraph', 'graph', { projectId: form.graphProjectId.trim() || report.reads?.projectId, otherAccountId: form.otherAccountId.trim(), persisted: JSON.parse(persisted || '[]') })}>Graph only</Button>
      </Inline>
      {busy ? <Lozenge appearance="inprogress">Running {busy}</Lozenge> : null}
      {error ? <SectionMessage appearance="error" title="Error"><Text>{error}</Text></SectionMessage> : null}
      {verdicts(report).map((v) => (
        <SectionMessage key={v.spike} appearance={v.verdict === 'GO' ? 'success' : v.verdict.startsWith('PARTIAL') ? 'warning' : 'error'} title={`${v.spike}: ${v.verdict}`}>
          <Text>{v.note}</Text>
        </SectionMessage>
      ))}
      <Heading as="h3" size="small">Report</Heading>
      <CodeBlock language="json" text={JSON.stringify(report, null, 2)} shouldWrapLongLines />
      <Heading as="h3" size="small">Raw Teamwork Graph query (as you)</Heading>
      <TextArea id="raw-query" name="raw-query" value={rawQuery} onChange={(e) => { const v = e.target.value; setRawQuery(() => v); }} />
      <TextArea id="raw-vars" name="raw-vars" value={rawVariables} onChange={(e) => { const v = e.target.value; setRawVariables(() => v); }} />
      <Button isDisabled={Boolean(busy)} onClick={() => run('runGraphQuery', 'rawGraph', { query: rawQuery, variables: rawVariables })}>Run query</Button>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
