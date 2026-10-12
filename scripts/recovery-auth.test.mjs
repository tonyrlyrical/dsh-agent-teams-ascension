import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import {
  compressPayload,
  recoverPayload,
  CavemanPayloadStore,
} from '../lib/caveman/proxy-engine.js'
import { apply as applyPlugin } from '../lib/index.js'

test('Priority 0 Security Audit: CavemanPayloadStore fail-closed in-memory & disk isolation', async (t) => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'caveman-auth-test-'))
  const teamAlpha = 'team-alpha-secure'
  const teamBravo = 'team-bravo-intruder'
  const secretContent = 'SECRET_KEY=alpha_classified_token_9876543210'

  try {
    const store = new CavemanPayloadStore({ maxEntries: 10, maxTotalBytes: 1024 * 1024 })

    // Store payload tied to teamAlpha with disk persistence
    const recoveryId = store.storePayload(secretContent, 'text', {
      teamId: teamAlpha,
      stateRoot: tmpDir,
    })
    assert.ok(recoveryId, 'Payload ID must be generated')

    // 1. In-memory lookup: Missing options or undefined teamId must fail closed
    const noContext = store.getPayload(recoveryId)
    assert.equal(noContext.ok, false, 'In-memory retrieval without options must fail')
    assert.ok(noContext.error?.includes('Unauthorized'), 'Must return Unauthorized error')

    const undefinedTeam = store.getPayload(recoveryId, { teamId: undefined })
    assert.equal(undefinedTeam.ok, false, 'In-memory retrieval with undefined teamId must fail')
    assert.ok(undefinedTeam.error?.includes('Unauthorized'), 'Must return Unauthorized error')

    // 2. In-memory lookup: Wrong team must fail closed
    const wrongTeam = store.getPayload(recoveryId, { teamId: teamBravo })
    assert.equal(wrongTeam.ok, false, 'In-memory retrieval from wrong team must fail')
    assert.ok(wrongTeam.error?.includes('Unauthorized'), 'Must return Unauthorized error')

    // 3. In-memory lookup: Authorized team succeeds
    const authorizedAlpha = store.getPayload(recoveryId, { teamId: teamAlpha })
    assert.equal(authorizedAlpha.ok, true, 'In-memory retrieval from authorized team must succeed')
    assert.equal(authorizedAlpha.content, secretContent)

    // 4. Disk fallback: Create a fresh store to clear in-memory cache
    const freshStore = new CavemanPayloadStore({ maxEntries: 10, maxTotalBytes: 1024 * 1024 })
    assert.equal(freshStore.has(recoveryId), false, 'Fresh store has no in-memory cache')

    // 4a. Disk fallback: Missing teamId must fail closed
    const diskNoContext = freshStore.getPayload(recoveryId, { stateRoot: tmpDir })
    assert.equal(diskNoContext.ok, false, 'Disk fallback without teamId must fail')

    // 4b. Disk fallback: Wrong team must fail closed
    const diskWrongTeam = freshStore.getPayload(recoveryId, { stateRoot: tmpDir, teamId: teamBravo })
    assert.equal(diskWrongTeam.ok, false, 'Disk fallback from wrong team must fail')

    // 4c. Disk fallback: Authorized team succeeds and re-populates memory
    const diskAlpha = freshStore.getPayload(recoveryId, { stateRoot: tmpDir, teamId: teamAlpha })
    assert.equal(diskAlpha.ok, true, 'Disk fallback for authorized team must succeed')
    assert.equal(diskAlpha.content, secretContent)
    assert.equal(freshStore.has(recoveryId), true, 'Payload re-cached in memory')

    // 5. Path traversal sanitization
    // 5a. Attempt path traversal in recoveryId
    const traversalId = store.storePayload('Sensitive data', 'text', {
      teamId: teamAlpha,
      stateRoot: tmpDir,
    })
    const maliciousIdResult = freshStore.getPayload(`../../etc/passwd`, { stateRoot: tmpDir, teamId: teamAlpha })
    assert.equal(maliciousIdResult.ok, false, 'Directory traversal in recovery ID must be rejected')

    // 5b. Attempt path traversal in teamId
    const maliciousTeamResult = freshStore.getPayload(recoveryId, { stateRoot: tmpDir, teamId: '../../evil-team' })
    assert.equal(maliciousTeamResult.ok, false, 'Directory traversal in teamId must be rejected')
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test('Priority 0 Security Audit: agent_teams_recover_payload tool authorization matrix', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-recover-auth-matrix-'))
  const stateDir = '.agent-teams'
  const stateRoot = join(workspace, stateDir)

  const toolRegistry = new Map()
  const liveAgents = new Map()

  const ctx = {
    workspace,
    effect: (setup) => setup(),
    inject: () => {},
    get: () => undefined,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    tools: {
      register: (tool) => {
        toolRegistry.set(tool.name, tool)
      },
    },
    agents: {
      get: (id) => liveAgents.get(id),
      list: () => Array.from(liveAgents.values()),
    },
    systemPrompt: {
      section: () => {},
    },
    llm: {
      resolveCallConfig: async (config) => config,
      listModels: async (provider) => [{ provider, id: 'deepseek-chat', name: 'deepseek-chat' }],
    },
    subagents: {
      followup: async () => {},
      registerContinuableSetup: () => {},
      listChildren: async () => [],
      listDescendants: async () => [],
      interrupt: () => {},
      drainContinuableChildren: async () => {},
    },
    on: () => {},
    emit: async () => {},
  }

  try {
    // 1. Mount plugin
    applyPlugin(ctx, { stateDir, defaultOperatingMode: 'economy' })

    const recoverTool = toolRegistry.get('agent_teams_recover_payload')
    assert.ok(recoverTool, 'agent_teams_recover_payload tool must be registered')

    // 2. Setup team Alpha (captain: alpha-cap, member: alpha-mem)
    //    and team Bravo (captain: bravo-cap, member: bravo-mem)
    const alphaCapId = 'sess-alpha-cap'
    const alphaMemId = 'sess-alpha-mem'
    const bravoCapId = 'sess-bravo-cap'
    const unauthedId = 'sess-unauthed'

    const makeAgent = (id, parentSession) => ({
      id,
      status: 'idle',
      session: {
        id,
        header: { cwd: workspace, parentSession },
        requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-chat' } }),
      },
    })

    const alphaCap = makeAgent(alphaCapId, undefined)
    const alphaMem = makeAgent(alphaMemId, alphaCapId)
    const bravoCap = makeAgent(bravoCapId, undefined)
    const unauthedAgent = makeAgent(unauthedId, undefined)

    liveAgents.set(alphaCapId, alphaCap)
    liveAgents.set(alphaMemId, alphaMem)
    liveAgents.set(bravoCapId, bravoCap)
    liveAgents.set(unauthedId, unauthedAgent)

    // Initialize team Alpha via agent_teams_create
    const createTool = toolRegistry.get('agent_teams_create')
    const createAlphaRes = await createTool.execute(
      {
        name: 'alpha-team',
        description: 'Alpha team for security test',
        plan: {
          members: [{ name: 'member-alpha', role: 'Worker' }],
          tasks: [{ id: 'task-1', subject: 'Task 1', assignee: 'member-alpha' }],
        },
      },
      { agent: alphaCap, session: alphaCap.session }
    )
    assert.ok(createAlphaRes.team_id, 'Alpha team initialized')
    const alphaTeamId = createAlphaRes.team_id

    // Bind alphaMem as the member-alpha agent in team Alpha
    const { readTeam, writeTeam } = await import('../lib/state.js')
    const alphaTeam = await readTeam(stateRoot, alphaTeamId)
    assert.ok(alphaTeam)
    alphaTeam.members[0].id = alphaMemId
    alphaTeam.members[0].status = 'idle'
    await writeTeam(stateRoot, alphaTeam)

    // Initialize team Bravo via agent_teams_create
    const createBravoRes = await createTool.execute(
      {
        name: 'bravo-team',
        description: 'Bravo team for intruder test',
        plan: {
          members: [{ name: 'member-bravo', role: 'Worker' }],
          tasks: [{ id: 'task-1', subject: 'Task 1', assignee: 'member-bravo' }],
        },
      },
      { agent: bravoCap, session: bravoCap.session }
    )
    assert.ok(createBravoRes.team_id, 'Bravo team initialized')
    const bravoTeamId = createBravoRes.team_id

    // Compress a substantial payload in Team Alpha's context
    const rows = ['id,agent_name,role,status,tasks_count,tokens_used,latency_ms']
    for (let i = 1; i <= 25; i++) {
      rows.push(`${i},worker-${i},role-${i},active,${i * 2},${i * 1500},${300 + i * 20}`)
    }
    const largeAlphaLog = rows.join('\n')

    const comp = compressPayload(largeAlphaLog, {
      minBytes: 50,
      teamId: alphaTeamId,
      stateRoot,
    })
    assert.ok(comp.wasCompressed, 'Payload was compressed')
    assert.ok(comp.recoveryId, 'Recovery ID generated')
    const recoveryId = comp.recoveryId

    // TEST 1: Unauthenticated caller (exec.agent === undefined) -> FAILS CLOSED
    const unauthedExecRes = await recoverTool.execute(
      { recovery_id: recoveryId },
      { session: alphaCap.session } // agent is undefined
    )
    assert.equal(unauthedExecRes.ok, false)
    assert.ok(
      unauthedExecRes.error?.includes('Unauthorized: agent_teams tools require an authenticated calling agent'),
      'Unauthenticated caller must fail with explicit Unauthorized error'
    )

    // TEST 2: Absent / Outside team context (caller not member of any team) -> FAILS CLOSED
    const outsideTeamRes = await recoverTool.execute(
      { recovery_id: recoveryId },
      { agent: unauthedAgent, session: unauthedAgent.session }
    )
    assert.equal(outsideTeamRes.ok, false)
    assert.ok(
      outsideTeamRes.error?.includes('Unauthorized: caller does not participate in any active team'),
      'Outside agent without team membership must fail with explicit error'
    )

    // TEST 3: Wrong team caller (Bravo captain requesting Alpha payload) -> FAILS CLOSED
    const wrongTeamRes = await recoverTool.execute(
      { recovery_id: recoveryId },
      { agent: bravoCap, session: bravoCap.session }
    )
    assert.equal(wrongTeamRes.ok, false)
    assert.ok(
      wrongTeamRes.error?.includes('Unauthorized: payload') && wrongTeamRes.error?.includes('belongs to another team'),
      'Wrong team caller must be denied with cross-team Unauthorized error'
    )

    // TEST 4: Authorized team member of Alpha -> SUCCEEDS
    const memberRes = await recoverTool.execute(
      { recovery_id: recoveryId },
      { agent: alphaMem, session: alphaMem.session }
    )
    assert.equal(memberRes.ok, true, 'Authorized team member must succeed')
    assert.equal(memberRes.content, largeAlphaLog)
    assert.equal(memberRes.original_bytes, Buffer.byteLength(largeAlphaLog, 'utf8'))

    // TEST 5: Authorized captain of Alpha -> SUCCEEDS
    const captainRes = await recoverTool.execute(
      { recovery_id: recoveryId },
      { agent: alphaCap, session: alphaCap.session }
    )
    assert.equal(captainRes.ok, true, 'Authorized captain must succeed')
    assert.equal(captainRes.content, largeAlphaLog)

    // TEST 6: SHA-256 integrity verification
    const originalHash = createHash('sha256').update(largeAlphaLog).digest('hex')
    const recoveredHash = createHash('sha256').update(memberRes.content).digest('hex')
    assert.equal(recoveredHash, originalHash, 'Recovered payload must have identical SHA-256 hash')

  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
