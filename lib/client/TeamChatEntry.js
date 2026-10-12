import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { AgentTeamsSummary, openActivityPanel } from "./AgentTeamsCard.js";
import { getActivitySnapshotsSnapshot, subscribeActivitySnapshots } from "./activity-monitor.js";
import { teamCardsForTurn } from "./agent-teams-card-definition.js";
import { LEAD_ART } from "./artwork.js";
import css from './AgentTeamsCard.module.css';
/** Insert or update the /agent-teams invocation in the composer and focus it. */
export function populateComposerWithTeamCommand(selectedMode) {
    const composer = document.querySelector('[data-composer-card] [contenteditable="true"][role="textbox"], [data-composer-card] textarea, textarea');
    if (!composer)
        return;
    const modeFlag = selectedMode === 'economy' ? '--economy ' : '';
    const commandText = `/agent-teams ${modeFlag}`;
    if ('value' in composer && typeof composer.value === 'string') {
        const textarea = composer;
        const currentVal = textarea.value.trim();
        if (currentVal.startsWith('/agent-teams')) {
            textarea.value = currentVal.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText);
        }
        else {
            textarea.value = currentVal ? `${commandText}${currentVal}` : commandText;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    else if (composer.isContentEditable) {
        const currentText = composer.textContent?.trim() ?? '';
        if (currentText.startsWith('/agent-teams')) {
            composer.textContent = currentText.replace(/^\/agent-teams(\s+--economy|\s+--mode\s+\w+)?\s*/, commandText);
        }
        else {
            composer.textContent = currentText ? `${commandText}${currentText}` : commandText;
        }
        composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
    composer.focus();
}
export function TeamChatEntry({ sessionId, t }) {
    const { teams, archivedTeams } = useSyncExternalStore(subscribeActivitySnapshots, getActivitySnapshotsSnapshot);
    const team = [...teams, ...archivedTeams].find(team => team.captainSessionId === sessionId);
    const [mode, setMode] = useState('economy');
    if (!team) {
        return (_jsxs("div", { className: css.launcherGroup, "data-agent-teams-launcher": true, children: [_jsxs("button", { className: css.chatEntry, "data-team-launch-btn": true, type: "button", title: "Activar Agent Teams en este chat", onClick: () => populateComposerWithTeamCommand(mode), children: [_jsx("img", { src: LEAD_ART, alt: "", "aria-hidden": true }), _jsx("span", { children: "Agent Teams" })] }), _jsxs("select", { className: css.modeSelect, "data-team-mode-select": true, value: mode, "aria-label": "Modo de ejecuci\u00F3n Agent Teams", onChange: (e) => {
                        const nextMode = e.target.value;
                        setMode(nextMode);
                        populateComposerWithTeamCommand(nextMode);
                    }, children: [_jsx("option", { value: "economy", children: "\u26A1 Economy" }), _jsx("option", { value: "normal", children: "Normal" })] })] }));
    }
    return (_jsxs("button", { className: css.chatEntry, "data-team-chat-entry": true, type: "button", title: t('workspace.focus'), onClick: () => openActivityPanel({ teamId: team.teamId, captainSessionId: sessionId, teamName: team.name, members: team.members }), children: [_jsx("img", { src: LEAD_ART, alt: "", "aria-hidden": true }), _jsx("span", { children: t('workspace.focus') }), _jsx("span", { className: css.modeBadge, children: team.operatingMode === 'economy' ? '⚡ Economy' : 'Normal' })] }));
}
export function TeamTurnCard({ sessionId, turn, useChat, t, openMember }) {
    const nodes = useChat(snapshot => snapshot.nodes);
    const cards = teamCardsForTurn(nodes.values(), turn.turn);
    if (turn.status !== 'closed' || cards.length === 0)
        return null;
    return _jsx("div", { className: css.turnCards, "data-team-turn-cards": true, children: cards.map(node => _jsx(AgentTeamsSummary, { data: node.data, sessionId: sessionId, t: t, openMember: openMember }, node.key)) });
}
