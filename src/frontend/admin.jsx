// Wall admin page (UI Kit): the walls, raising a wall, and one wall's state.

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

async function call(name, payload = {}) {
  const result = await invoke(name, payload);
  if (result?.error) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result?.data;
}

const fmt = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '');
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : '');

const EVIDENCE = {
  'confirmed-by-jira': ['success', 'Confirmed by Jira'],
  'proven-static': ['default', 'From the scheme'],
  conditional: ['moved', 'Depends on the item'],
  unknown: ['removed', 'Not visible to apps'],
};

const STATUS = {
  active: ['success', 'Recorded'],
  'awaiting-acknowledgement': ['inprogress', 'Awaiting acknowledgement'],
  expired: ['removed', 'Expired, still inside'],
  ended: ['default', 'Ended'],
  scheduled: ['new', 'Scheduled'],
};

const POWER = {
  'edit-permission-scheme': 'Edits the permission scheme and any project role',
  'edit-role-members': 'Adds people to the roles that grant Browse',
  'edit-group-members': 'Adds people to the groups that grant Browse',
  'grant-self-admin': 'Can make themselves a Jira admin',
};

function Evidence({ level }) {
  const [appearance, text] = EVIDENCE[level] ?? ['default', level];
  return <Lozenge appearance={appearance}>{text}</Lozenge>;
}

function Person({ p }) {
  return (
    <Inline space="space.050" alignBlock="center" shouldWrap>
      <Text>{p.displayName ?? p.label}</Text>
      {p.active === false ? <Lozenge>Inactive</Lozenge> : null}
      {p.accountType === 'app' ? <Lozenge appearance="new">App</Lozenge> : null}
    </Inline>
  );
}

function table(head, rows) {
  return {
    head: { cells: head.map((content, i) => ({ key: `h${i}`, content })) },
    rows: rows.map((cells, r) => ({ key: `r${r}`, cells: cells.map((content, c) => ({ key: `c${r}-${c}`, content })) })),
  };
}

// ---------------------------------------------------------------------------

function WallList({ walls, onOpen }) {
  if (!walls.length) {
    return <EmptyState header="No walls yet" description="Raise a wall over a confidential project to see who can see it, who can change that, and every crossing." />;
  }
  const { head, rows } = table(
    ['Project', 'Inside information', 'Can see', 'Last check', ''],
    walls.map((w) => [
      <Strong>{w.projectKey}</Strong>,
      <Text>{w.subject}</Text>,
      <Text>{w.lastScan?.summary?.counts?.canSee ?? '-'}</Text>,
      <Inline space="space.050">
        <Text>{fmt(w.lastScan?.takenAt)}</Text>
        {w.lastScan?.summary?.drift ? (
          <Lozenge appearance={w.lastScan.summary.drift.status === 'intact' ? 'success' : 'removed'}>{w.lastScan.summary.drift.status}</Lozenge>
        ) : null}
      </Inline>,
      <Button onClick={() => onOpen(w.wallId)}>Open</Button>,
    ]),
  );
  return <DynamicTable head={head} rows={rows} />;
}

function RaiseWall({ onRaised }) {
  const [projects, setProjects] = useState(null);
  const [project, setProject] = useState(null);
  const [subject, setSubject] = useState('');
  const [codeName, setCodeName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    call('candidateProjects')
      .then((r) => setProjects(r.projects.filter((p) => !p.teamManaged && !p.walled)))
      .catch((e) => setError(e.message));
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await call('raiseWall', { projectKey: project?.value, subject, codeName });
      onRaised(result.wallId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!projects) return error ? <SectionMessage appearance="error" title="Projects could not be read"><Text>{error}</Text></SectionMessage> : <Spinner label="Loading projects" />;
  return (
    <Stack space="space.150">
      <Text>Wall records everyone who can see the project now as a baseline crossing; each of them still has to acknowledge. Team-managed projects are not listed: their access is not set by a permission scheme.</Text>
      <Stack space="space.050">
        <Label labelFor="wall-project">Project</Label>
        <Select inputId="wall-project" options={projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} value={project} onChange={(v) => setProject(v)} placeholder="Choose a company-managed project" />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="wall-subject">Inside information this project holds</Label>
        <Textfield id="wall-subject" value={subject} onChange={(e) => { const v = e.target.value; setSubject(() => v); }} placeholder="For example: proposed acquisition of a listed competitor" />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="wall-code">Code name (optional)</Label>
        <Textfield id="wall-code" value={codeName} onChange={(e) => { const v = e.target.value; setCodeName(() => v); }} placeholder="Falcon" />
      </Stack>
      {error ? <SectionMessage appearance="error" title="The wall was not raised"><Text>{error}</Text></SectionMessage> : null}
      <Inline>
        <Button appearance="primary" isDisabled={busy || !project || subject.trim().length < 3} onClick={submit}>
          {busy ? 'Raising…' : 'Raise the wall'}
        </Button>
      </Inline>
    </Stack>
  );
}

// ---------------------------------------------------------------------------

function CanSee({ view }) {
  const byAccount = new Map(view.crossings.filter((c) => c.status !== 'ended').map((c) => [c.accountId, c]));
  const { head, rows } = table(
    ['Person', 'Through', 'Evidence', 'Crossing'],
    view.tiers.canSee.map((p) => {
      const crossing = byAccount.get(p.accountId);
      const [appearance, text] = crossing ? STATUS[crossing.status] ?? ['default', crossing.status] : p.accountType === 'app' ? ['new', 'App account'] : ['removed', 'Not recorded'];
      return [<Person p={p} />, <Text>{p.routeText.join('; ')}</Text>, <Evidence level={p.evidence} />, <Lozenge appearance={appearance}>{text}</Lozenge>];
    }),
  );
  const check = view.jiraCheck;
  return (
    <Stack space="space.150">
      {view.tiers.openings.length ? (
        <SectionMessage appearance="error" title="This project is not sealed">
          <Text>{view.tiers.openings.map((o) => `${o.label} (${o.tier === 'can-see' ? 'can see it' : 'can administer it'})`).join('; ')}</Text>
        </SectionMessage>
      ) : null}
      <DynamicTable head={head} rows={rows} />
      {check?.available ? (
        <Text>
          Jira's own list of people who can browse the project agrees on {check.confirmed.length} of {view.tiers.canSee.length}.
          {check.onlyInModel.length ? ` Not in Jira's list: ${check.onlyInModel.length} (usually inactive accounts).` : ''}
          {check.onlyInJira.length ? ` Only in Jira's list: ${check.onlyInJira.length}.` : ''}
        </Text>
      ) : null}
    </Stack>
  );
}

function CanChange({ view }) {
  const names = new Map(view.tiers.canChange.filter((p) => p.accountId).map((p) => [p.accountId, p.displayName]));
  const { head, rows } = table(
    ['Who', 'What they can do', 'Evidence', 'Can see it now'],
    view.tiers.canChange.map((p) => [
      <Person p={p} />,
      <Text>{p.powers.map((x) => POWER[x.power] ?? x.power).join('; ')}</Text>,
      <Evidence level={p.evidence} />,
      <Text>{p.canSee == null ? '-' : p.canSee ? 'Yes' : 'No'}</Text>,
    ]),
  );
  return (
    <Stack space="space.150">
      {view.tiers.selfAdmit.length ? (
        <SectionMessage appearance="warning" title={`${view.tiers.selfAdmit.length} admin(s) can let themselves in`}>
          <Text>{view.tiers.selfAdmit.map((id) => names.get(id) ?? id).join(', ')} cannot see the project now but can change who sees it. Wall flags it if they do.</Text>
        </SectionMessage>
      ) : null}
      <DynamicTable head={head} rows={rows} />
      <Text>
        Jira has no list of its admins: Wall checked {view.adminCheck?.checked ?? 0} account(s) with Jira's permission check
        {view.adminCheck?.complete ? '' : ' (not everyone it found)'}. Organization admins and group managers are not visible to apps.
      </Text>
      {view.tiers.sharedScheme.length ? <Text>The permission scheme is shared with {view.tiers.sharedScheme.join(', ')}: a change made for those projects changes this wall too.</Text> : null}
    </Stack>
  );
}

function Drift({ view }) {
  const d = view.drift;
  if (!d) return <Text>{view.tiers.reason}</Text>;
  return (
    <Stack space="space.150">
      <SectionMessage appearance={d.status === 'intact' ? 'success' : 'error'} title={d.status === 'intact' ? 'Everyone who can see the project has a recorded crossing' : 'Access and ledger disagree'}>
        <Text>Checked {fmt(d.at)}. Recorded {d.summary.recorded} of {d.summary.canSee}; unrecorded {d.summary.unrecorded}; overstays {d.summary.overstay}.</Text>
      </SectionMessage>
      {d.unrecorded.map((u) => (
        <SectionMessage key={u.accountId} appearance="warning" title={`${u.displayName} can see the project without a recorded crossing`}>
          <Text>{u.attribution.sentence}</Text>
        </SectionMessage>
      ))}
      {d.overstay.map((o) => (
        <SectionMessage key={o.accountId} appearance="warning" title={`${o.displayName}'s crossing expired ${fmt(o.expiresAt)} but access remains`}>
          <Text>Remove the access, or extend the crossing with a new approval.</Text>
        </SectionMessage>
      ))}
      {d.extraRoutes.map((e) => (
        <SectionMessage key={e.accountId} appearance="information" title="More than one way in">
          <Text>{e.sentence}</Text>
        </SectionMessage>
      ))}
      {d.stale.length ? <Text>{d.stale.length} recorded crossing(s) no longer have access in Jira; end them in the ledger.</Text> : null}
      {d.unacknowledged.length ? <Text>{d.unacknowledged.length} person(s) have not acknowledged their duties within 48 hours.</Text> : null}
      {view.audit.error ? (
        <SectionMessage appearance="warning" title="The audit log could not be read">
          <Text>Unrecorded crossings are found but not attributed. Jira answered: {view.audit.error.message}</Text>
        </SectionMessage>
      ) : (
        <Text>Attribution read {view.audit.read} audit record(s) since the wall was raised.</Text>
      )}
    </Stack>
  );
}

function Ledger({ view }) {
  const v = view.verification;
  const crossings = table(
    ['Person', 'Through', 'Reason', 'Obtained', 'Acknowledged', 'Status'],
    view.crossings.map((c) => {
      const [appearance, text] = STATUS[c.status] ?? ['default', c.status];
      return [
        <Person p={c} />,
        <Text>{c.routeText}</Text>,
        <Text>{c.baseline ? 'Held access when the wall was raised' : c.reason}</Text>,
        <Text>{fmt(c.obtainedAt)}</Text>,
        <Text>{fmt(c.acknowledgedAt) || '-'}</Text>,
        <Lozenge appearance={appearance}>{text}</Lozenge>,
      ];
    }),
  );
  const records = table(
    ['#', 'Record', 'Written', 'SHA-256'],
    view.records.map((r) => [<Text>{r.seq}</Text>, <Text>{r.type}</Text>, <Text>{fmt(r.at)}</Text>, <Text>{short(r.hash)}</Text>]),
  );
  return (
    <Stack space="space.150">
      <SectionMessage appearance={v.ok ? 'success' : 'error'} title={v.ok ? `The ledger verifies: ${v.length} records, chain intact${v.anchored ? ', matches the saved head' : ''}` : 'The ledger does not verify'}>
        <Text>{v.ok ? `Head ${short(v.head?.hash)} (record ${v.head?.seq}).` : v.problems.map((p) => p.message).join(' ')}</Text>
      </SectionMessage>
      <DynamicTable head={crossings.head} rows={crossings.rows} />
      <Heading as="h4" size="xsmall">Records</Heading>
      <DynamicTable head={records.head} rows={records.rows} rowsPerPage={10} />
      {view.certificate ? <Text>Certificate {short(view.certificate.certificateHash)} binds this scan, both tiers and the ledger head.</Text> : null}
    </Stack>
  );
}

function WallPage({ wallId, onBack }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setView(await call('wallView', { wallId }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [wallId]);

  return (
    <Stack space="space.200">
      <Inline space="space.100">
        <Button appearance="subtle" onClick={onBack}>All walls</Button>
        <Button isDisabled={loading} onClick={load}>{loading ? 'Checking…' : 'Check now'}</Button>
      </Inline>
      {error ? <SectionMessage appearance="error" title="The wall could not be read"><Text>{error}</Text></SectionMessage> : null}
      {!view ? (
        <Spinner label="Reading the project, the ledger and the audit log" />
      ) : (
        <Stack space="space.150">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Heading as="h2" size="medium">{view.wall.projectKey}{view.wall.codeName ? ` · ${view.wall.codeName}` : ''}</Heading>
            {view.drift ? <Lozenge appearance={view.drift.status === 'intact' ? 'success' : 'removed'} isBold>{view.drift.status === 'intact' ? 'Intact' : 'Drift'}</Lozenge> : null}
            {view.tiers.sealed === false ? <Lozenge appearance="removed">Not sealed</Lozenge> : null}
          </Inline>
          <Text>{view.wall.subject}</Text>
          <Text>
            {view.tiers.counts?.canSee ?? 0} can see it · {view.tiers.counts?.canChangePeople ?? 0} can change who sees it · wall raised {fmt(view.wall.raisedAt)}
          </Text>
          <Tabs id="wall-tabs">
            <TabList>
              <Tab>Who can see</Tab>
              <Tab>Who can change it</Tab>
              <Tab>Drift</Tab>
              <Tab>Ledger</Tab>
            </TabList>
            <TabPanel>
              <Box padding="space.150"><CanSee view={view} /></Box>
            </TabPanel>
            <TabPanel>
              <Box padding="space.150"><CanChange view={view} /></Box>
            </TabPanel>
            <TabPanel>
              <Box padding="space.150"><Drift view={view} /></Box>
            </TabPanel>
            <TabPanel>
              <Box padding="space.150"><Ledger view={view} /></Box>
            </TabPanel>
          </Tabs>
        </Stack>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------

const App = () => {
  const [walls, setWalls] = useState(null);
  const [open, setOpen] = useState(null);
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState(null);

  const loadWalls = () =>
    call('listWalls')
      .then(setWalls)
      .catch((e) => setError(e.message));
  useEffect(() => {
    loadWalls();
  }, []);

  if (open) {
    return (
      <WallPage
        wallId={open}
        onBack={() => {
          setOpen(null);
          loadWalls();
        }}
      />
    );
  }
  return (
    <Stack space="space.200">
      <Heading as="h2" size="medium">Walls</Heading>
      <Text>A wall keeps a need-to-know project walled: who can see it, who can change that, and a hash-chained ledger of every crossing. Wall helps keep the records; it does not make anyone compliant with anything by itself.</Text>
      {error ? <SectionMessage appearance="error" title="Wall could not load"><Text>{error}</Text></SectionMessage> : null}
      {walls ? <WallList walls={walls} onOpen={setOpen} /> : error ? null : <Spinner label="Loading walls" />}
      {raising ? (
        <Box padding="space.150">
          <Heading as="h3" size="small">Raise a wall</Heading>
          <RaiseWall
            onRaised={(wallId) => {
              setRaising(false);
              setOpen(wallId);
            }}
          />
        </Box>
      ) : (
        <Inline>
          <Button appearance="primary" onClick={() => setRaising(true)}>Raise a wall</Button>
        </Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
