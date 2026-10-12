import { useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentTeamsSummary, openActivityPanel, type AgentTeamsCardInjected } from './AgentTeamsCard.tsx'
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from './activity-monitor.ts'
import { teamCardsForTurn } from './agent-teams-card-definition.ts'
import { LEAD_ART } from './artwork.ts'
import css from './AgentTeamsCard.module.css'

/** Insert or update the /agent-teams invocation in the composer and focus it. */
export function populateComposerWithTeamCommand(selectedMode: 'normal' | 'economy'): void {
  const composer = document.querySelector<HTMLTextAreaElement | HTMLDivElement>(
    '[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea, textarea'
  )
  if (!composer) return

  const modeFlag = selectedMode === 'economy' ? '--economy ' : ''
  const commandText = `/agent-teams ${modeFlag}`

  if ('value' in composer && typeof (composer as HTMLTextAreaElement).value === 'string') {
    const textarea = composer as HTMLTextAreaElement
    const currentVal = textarea.value.trim()
    if (currentVal.startsWith('/agent-teams')) {
      textarea.value = currentVal.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText)
    } else {
      textarea.value = currentVal ? `${commandText}${currentVal}` : commandText
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  } else if (composer.isContentEditable) {
    const currentText = composer.textContent?.trim() ?? ''
    if (currentText.startsWith('/agent-teams')) {
      composer.textContent = currentText.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText)
    } else {
      composer.textContent = currentText ? `${commandText}${currentText}` : commandText
    }
    composer.dispatchEvent(new Event('input', { bubbles: true }))
  }
  composer.focus()
}

export function TeamChatEntry({ sessionId, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'>) {
  const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot)
  const team = [...teams, ...archivedTeams].find(team => team.captainSessionId === sessionId)
  const [mode, setMode] = useState<'normal' | 'economy'>('economy')

  if (!team) {
    return (
      <div className={css.launcherGroup} data-agent-teams-launcher>
        <button
          className={css.chatEntry}
          data-team-launch-btn
          type="button"
          title="Activar Agent Teams en este chat"
          onClick={() => populateComposerWithTeamCommand(mode)}
        >
          <img src={LEAD_ART} alt="" aria-hidden />
          <span>Agent Teams</span>
        </button>
        <select
          className={css.modeSelect}
          data-team-mode-select
          value={mode}
          aria-label="Modo de ejecución Agent Teams"
          onChange={(e) => {
            const nextMode = e.target.value as 'normal' | 'economy'
            setMode(nextMode)
            populateComposerWithTeamCommand(nextMode)
          }}
        >
          <option value="economy">⚡ Economy</option>
          <option value="normal">Normal</option>
        </select>
      </div>
    )
  }

  return (
    <button className={css.chatEntry} data-team-chat-entry type="button" title={t('workspace.focus')}
      onClick={() => openActivityPanel({ teamId: team.teamId, captainSessionId: sessionId, teamName: team.name, members: team.members })}>
      <img src={LEAD_ART} alt="" aria-hidden />
      <span>{t('workspace.focus')}</span>
      <span className={css.modeBadge}>{team.operatingMode === 'economy' ? '⚡ Economy' : 'Normal'}</span>
    </button>
  )
}

export function TeamTurnCard({ sessionId, turn, useChat, t, openMember }: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'agentTeams'> & AgentTeamsCardInjected) {
  const nodes = useChat(snapshot => snapshot.nodes)
  const cards = teamCardsForTurn(nodes.values(), turn.turn)
  if (turn.status !== 'closed' || cards.length === 0) return null
  return <div className={css.turnCards} data-team-turn-cards>{cards.map(node => <AgentTeamsSummary key={node.key}
    data={node.data as import('./agent-teams-card-definition.ts').AgentTeamsCardData}
    sessionId={sessionId} t={t} openMember={openMember} />)}</div>
}
