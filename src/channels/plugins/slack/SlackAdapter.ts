/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IUnifiedIncomingMessage,
  IUnifiedMessageContent,
  IUnifiedOutgoingMessage,
  IUnifiedUser,
  IUnifiedAttachment,
} from '../../types';

/**
 * SlackAdapter - Converts between Slack and Unified message formats
 *
 * Handles:
 * - Slack event → UnifiedIncomingMessage
 * - UnifiedOutgoingMessage → Slack message format
 * - User info extraction
 * - Block Kit formatting
 */

// Slack message limit (approximately)
export const SLACK_MESSAGE_LIMIT = 40000; // Slack allows 40,000 characters

// ==================== Incoming Message Conversion ====================

/**
 * Convert Slack message event to unified incoming message
 */
export function toUnifiedIncomingMessage(event: any): IUnifiedIncomingMessage | null {
  if (!event) return null;

  // Handle regular message
  if (event.type === 'message' && !event.subtype) {
    const user = toUnifiedUser(event.user, event.user_profile);
    if (!user) return null;

    const content = extractMessageContent(event);

    return {
      id: event.ts || event.event_ts || Date.now().toString(),
      platform: 'slack',
      chatId: event.channel || '',
      user,
      content,
      timestamp: parseFloat(event.ts || event.event_ts || '0') * 1000,
      replyToMessageId: event.thread_ts,
      raw: event,
    };
  }

  // Handle app_mention event
  if (event.type === 'app_mention') {
    const user = toUnifiedUser(event.user, event.user_profile);
    if (!user) return null;

    // Remove bot mention from text
    let text = event.text || '';
    // Remove <@BOTID> pattern
    text = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    return {
      id: event.ts || event.event_ts || Date.now().toString(),
      platform: 'slack',
      chatId: event.channel || '',
      user,
      content: {
        type: 'text',
        text,
      },
      timestamp: parseFloat(event.ts || event.event_ts || '0') * 1000,
      replyToMessageId: event.thread_ts,
      raw: event,
    };
  }

  return null;
}

/**
 * Convert Slack user info to unified user format
 */
export function toUnifiedUser(userId: string, userProfile?: any): IUnifiedUser | null {
  if (!userId) return null;

  const displayName = userProfile?.display_name || userProfile?.real_name || userProfile?.name || `User ${userId}`;

  return {
    id: userId,
    username: userProfile?.name,
    displayName,
    avatarUrl: userProfile?.image_72 || userProfile?.image_48,
  };
}

/**
 * Extract message content from Slack event
 */
function extractMessageContent(event: any): IUnifiedMessageContent {
  const text = event.text || '';
  const attachments: IUnifiedAttachment[] = [];

  // Handle file attachments
  if (event.files && Array.isArray(event.files)) {
    for (const file of event.files) {
      const type = getAttachmentType(file.mimetype);
      if (type) {
        attachments.push({
          type,
          fileId: file.id,
          fileName: file.name,
          mimeType: file.mimetype,
          size: file.size,
        });
      }
    }
  }

  // Determine content type
  let contentType: 'text' | 'photo' | 'document' = 'text';
  if (attachments.length > 0) {
    const firstType = attachments[0].type;
    if (firstType === 'photo') {
      contentType = 'photo';
    } else if (firstType === 'document') {
      contentType = 'document';
    }
  }

  return {
    type: contentType,
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

/**
 * Get attachment type from MIME type
 */
function getAttachmentType(mimeType?: string): 'photo' | 'document' | 'audio' | 'video' | null {
  if (!mimeType) return 'document';

  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

// ==================== Outgoing Message Conversion ====================

/**
 * Convert unified outgoing message to Slack message parameters
 */
export function toSlackMessageParams(message: IUnifiedOutgoingMessage): {
  text: string;
  blocks?: any[];
  attachments?: any[];
} {
  const text = message.text || '';

  // For simple text messages, just send text
  if (!message.buttons || message.buttons.length === 0) {
    return { text };
  }

  // Build blocks for messages with buttons
  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: text || ' ',
      },
    },
  ];

  // Add action buttons
  const actions: any[] = [];
  for (const button of message.buttons) {
    actions.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: button.text,
        emoji: true,
      },
      value: button.data,
      action_id: `button_${button.data}`,
    });
  }

  if (actions.length > 0) {
    blocks.push({
      type: 'actions',
      elements: actions.slice(0, 5), // Slack allows max 5 buttons per block
    });
  }

  return {
    text,
    blocks,
  };
}

/**
 * Split long message into chunks
 */
export function splitMessage(text: string, maxLength: number = SLACK_MESSAGE_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  const lines = text.split('\n');
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // If a single line is too long, split it
      if (line.length > maxLength) {
        let remainingLine = line;
        while (remainingLine.length > 0) {
          chunks.push(remainingLine.slice(0, maxLength));
          remainingLine = remainingLine.slice(maxLength);
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
