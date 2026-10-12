import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type AgentTeamsCardInjected } from './AgentTeamsCard.tsx';
/** Insert or update the /agent-teams invocation in the composer and focus it. */
export declare function populateComposerWithTeamCommand(selectedMode: 'normal' | 'economy'): void;
export declare function TeamChatEntry({ sessionId, t }: PropsRuntime<'conversation.session.header.actions'> & PropsLocale<'agentTeams'>): import("react").JSX.Element;
export declare function TeamTurnCard({ sessionId, turn, useChat, t, openMember }: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'agentTeams'> & AgentTeamsCardInjected): import("react").JSX.Element | null;
