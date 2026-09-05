import {
  LOG_EVENT,
  type AppLogInput,
  type AppLogRecord,
  type LogChannel,
  type LogLevel
} from '@shared/appLog'
import type { LogStore } from '../store/LogStore'

export type AppLogger = {
  write(input: AppLogInput): AppLogRecord | null
  user(
    event: string,
    message: string,
    extra?: { conversationId?: string; data?: Record<string, unknown>; level?: LogLevel }
  ): AppLogRecord | null
  agent(
    event: string,
    message: string,
    extra?: {
      conversationId?: string
      data?: Record<string, unknown>
      level?: LogLevel
      retention?: AppLogInput['retention']
    }
  ): AppLogRecord | null
  system(
    event: string,
    message: string,
    extra?: { data?: Record<string, unknown>; level?: LogLevel }
  ): AppLogRecord | null
}

const noop: AppLogger = {
  write: () => null,
  user: () => null,
  agent: () => null,
  system: () => null
}

let instance: AppLogger = noop

export function createAppLogger(store: LogStore): AppLogger {
  const write = (input: AppLogInput): AppLogRecord | null => store.append(input)
  return {
    write,
    user(event, message, extra) {
      return write({
        channel: 'user',
        event,
        message,
        level: extra?.level ?? 'info',
        conversationId: extra?.conversationId,
        data: extra?.data
      })
    },
    agent(event, message, extra) {
      return write({
        channel: 'agent',
        event,
        message,
        level: extra?.level ?? 'info',
        retention: extra?.retention,
        conversationId: extra?.conversationId,
        data: extra?.data
      })
    },
    system(event, message, extra) {
      return write({
        channel: 'system',
        event,
        message,
        level: extra?.level ?? 'info',
        data: extra?.data
      })
    }
  }
}

export function setAppLogger(logger: AppLogger | null): void {
  instance = logger ?? noop
}

export function appLog(): AppLogger {
  return instance
}

export function logUserSend(
  conversationId: string,
  data: { chars: number; attachments: number; quoted?: boolean; contextBlocks?: number }
): void {
  appLog().user(LOG_EVENT.userSend, 'Send', {
    conversationId,
    data: {
      chars: data.chars,
      attachments: data.attachments,
      quoted: !!data.quoted,
      contextBlocks: data.contextBlocks ?? 0
    }
  })
}

export function logUserCancel(conversationId: string): void {
  appLog().user(LOG_EVENT.userCancel, 'Stop', { conversationId })
}

export function logUserAnswer(conversationId: string, toolCallId: string, chars: number): void {
  appLog().user(LOG_EVENT.userAnswer, 'Answer tool', {
    conversationId,
    data: { toolCallId, chars }
  })
}

export function isLogChannelName(value: string): value is LogChannel {
  return value === 'user' || value === 'agent' || value === 'system'
}
