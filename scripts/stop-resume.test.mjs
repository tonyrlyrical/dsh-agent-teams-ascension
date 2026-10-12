import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeTeam,
  readTeam,
  createTeamDir,
  resumeTeamState,
} from '../lib/state.js'

test('Stop & Resume Engine: safe halt and exact-progress resumption', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-stop-resume-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const teamId = 'ascension-stop-resume-test'

  const initialTasks = [
    {
      id: 't1',
      subject: 'Architecture review',
      status: 'completed',
      dependencies: [],
      output: 'Architecture validated.',
      createdAt: 1000,
      updatedAt: 2000,
    },
    {
      id: 't2',
      subject: 'Core implementation',
      status: 'in_progress',
      assignee: 'coder-alpha',
      attempt: 1,
      attemptId: 'att-123',
      dependencies: ['t1'],
      createdAt: 1000,
      updatedAt: 2500,
    },
    {
      id: 't3',
      subject: 'Quality assurance',
      status: 'pending',
      dependencies: ['t2'],
      createdAt: 1000,
      updatedAt: 1000,
    },
  ]

  const activeTeam = {
    id: teamId,
    name: 'Ascension Team',
    captainSessionId: 'sess-captain',
    createdAt: 1000,
    taskSeq: 3,
    phase: 'running',
    operatingMode: 'economy',
    members: [
      { id: 'sess-coder', name: 'coder-alpha', role: 'engineer', joinedAt: 1000, status: 'working' },
    ],
    tasks: initialTasks,
  }

  await createTeamDir(dir, activeTeam)

  await t.test('Safe Stop: halts team and cancels unfinished tasks without touching completed work', async () => {
    const team = await readTeam(dir, teamId)
    assert.ok(team)
    assert.equal(team.halted, undefined)

    // Simulate safe halt
    const now = Date.now()
    let cancelledCount = 0
    for (const task of team.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') continue
      task.status = 'cancelled'
      task.output = 'Stopped from the captain chat.'
      cancelledCount++
    }
    for (const member of team.members) {
      member.status = 'idle'
    }
    team.halted = true
    team.haltedAt = now

    await writeTeam(dir, team)

    const haltedTeam = await readTeam(dir, teamId)
    assert.ok(haltedTeam)
    assert.equal(haltedTeam.halted, true)
    assert.equal(haltedTeam.haltedAt, now)
    assert.equal(cancelledCount, 2)

    // t1 (completed) was preserved intact!
    const t1 = haltedTeam.tasks.find(t => t.id === 't1')
    assert.ok(t1)
    assert.equal(t1.status, 'completed')
    assert.equal(t1.output, 'Architecture validated.')

    // t2 and t3 were cancelled
    assert.equal(haltedTeam.tasks.find(t => t.id === 't2')?.status, 'cancelled')
    assert.equal(haltedTeam.tasks.find(t => t.id === 't3')?.status, 'cancelled')
  })

  await t.test('Safe Resume: clears halt, re-arms cancelled tasks to pending, keeps completed work intact', async () => {
    const haltedTeam = await readTeam(dir, teamId)
    assert.ok(haltedTeam)
    assert.equal(haltedTeam.halted, true)

    // Test resume validation
    const emptyReasonRes = resumeTeamState(haltedTeam, '')
    assert.equal(emptyReasonRes.ok, false)

    const resumeRes = resumeTeamState(haltedTeam, 'User requested continuation')
    assert.equal(resumeRes.ok, true)
    assert.equal(resumeRes.status, 'resumed')

    // Perform state restoration
    const fresh = haltedTeam
    fresh.halted = false
    fresh.haltedAt = undefined

    // Re-arm uncompleted tasks
    for (const task of fresh.tasks) {
      if (task.status === 'cancelled') {
        task.status = 'pending'
        task.output = undefined
        task.assignee = undefined
      }
    }
    for (const member of fresh.members) {
      member.status = 'idle'
    }

    await writeTeam(dir, fresh)

    const resumedTeam = await readTeam(dir, teamId)
    assert.ok(resumedTeam)
    assert.equal(resumedTeam.halted, false)
    assert.equal(resumedTeam.haltedAt, undefined)

    // t1 still completed
    const t1 = resumedTeam.tasks.find(t => t.id === 't1')
    assert.ok(t1)
    assert.equal(t1.status, 'completed')
    assert.equal(t1.output, 'Architecture validated.')

    // t2 and t3 re-armed to pending ready for execution
    assert.equal(resumedTeam.tasks.find(t => t.id === 't2')?.status, 'pending')
    assert.equal(resumedTeam.tasks.find(t => t.id === 't2')?.output, undefined)
    assert.equal(resumedTeam.tasks.find(t => t.id === 't3')?.status, 'pending')
  })
})
