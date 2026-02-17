/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { App, LogLevel } from '@slack/bolt';
import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { BasePlugin } from '../BasePlugin';
import { splitMessage, SLACK_MESSAGE_LIMIT, toSlackMessageParams, toUnifiedIncomingMessage, toUnifiedUser } from './SlackAdapter';

/**
 * SlackPlugin - Slack Bot integration for Personal Assistant
 *
 * Uses @slack/bolt library for Slack API
 * Supports Socket Mode for receiving events without webhooks
 */
export class SlackPlugin extends BasePlugin {
  readonly type: PluginType = 'slack';

  private app: App | null = null;
  private botInfo: { userId?: string; username?: string; displayName?: string } | null = null;
  private isConnected: boolean = false;

  // Track active users for status reporting
  private activeUsers: Set<string> = new Set();

  /**
   * Initialize the Slack bot instance
   */
  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const botToken = config.credentials?.botToken;
    const appToken = config.credentials?.appToken;
    const signingSecret = config.credentials?.signingSecret;

    if (!botToken || !appToken) {
      throw new Error('Slack bot token and app token are required');
    }

    // Create Slack app with Socket Mode
    this.app = new App({
      token: botToken,
      appToken: appToken,
      signingSecret: signingSecret,
      socketMode: true, // Use Socket Mode (no webhooks needed)
      logLevel: LogLevel.INFO,
    });

    // Setup event handlers
    this.setupHandlers();
  }

  /**
   * Start Socket Mode connection
   */
  protected async onStart(): Promise<void> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    try {
      // Start the app
      await this.app.start();

      // Get bot info
      const authResult = await this.app.client.auth.test();
      this.botInfo = {
        userId: authResult.user_id as string,
        username: authResult.user as string,
        displayName: authResult.user as string,
      };

      this.isConnected = true;
      console.log('[SlackPlugin] Connected successfully');
    } catch (error) {
      console.error('[SlackPlugin] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop and cleanup
   */
  protected async onStop(): Promise<void> {
    if (this.app) {
      try {
        await this.app.stop();
      } catch (error) {
        console.error('[SlackPlugin] Error stopping app:', error);
      }
    }

    this.app = null;
    this.botInfo = null;
    this.isConnected = false;
    this.activeUsers.clear();

    console.log('[SlackPlugin] Stopped and cleaned up');
  }

  /**
   * Get active user count
   */
  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  /**
   * Get bot information
   */
  getBotInfo(): BotInfo | null {
    if (!this.botInfo) return null;
    return {
      id: this.botInfo.userId || '',
      username: this.botInfo.username,
      displayName: this.botInfo.displayName,
    };
  }

  /**
   * Send a message to a channel
   */
  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    const params = toSlackMessageParams(message);

    // Handle long messages by splitting
    const chunks = splitMessage(params.text, SLACK_MESSAGE_LIMIT);
    let lastTimestamp = '';

    for (let i = 0; i < chunks.length; i++) {
      const isLastChunk = i === chunks.length - 1;
      const chunkParams = {
        channel: chatId,
        text: chunks[i],
        blocks: isLastChunk ? params.blocks : undefined,
        attachments: isLastChunk ? params.attachments : undefined,
      };

      try {
        const result = await this.app.client.chat.postMessage(chunkParams);
        if (result.ts) {
          lastTimestamp = result.ts;
        }
      } catch (error) {
        console.error(`[SlackPlugin] Failed to send message chunk ${i + 1}/${chunks.length}:`, error);
        throw error;
      }
    }

    return lastTimestamp;
  }

  /**
   * Edit an existing message
   */
  async editMessage(chatId: string, messageId: string, message: IUnifiedOutgoingMessage): Promise<void> {
    if (!this.app) {
      throw new Error('App not initialized');
    }

    const params = toSlackMessageParams(message);

    // Truncate if too long (can't split when editing)
    const truncatedText = params.text.length > SLACK_MESSAGE_LIMIT ? params.text.slice(0, SLACK_MESSAGE_LIMIT - 3) + '...' : params.text;

    try {
      await this.app.client.chat.update({
        channel: chatId,
        ts: messageId,
        text: truncatedText,
        blocks: params.blocks,
        attachments: params.attachments,
      });
    } catch (error: any) {
      // Ignore "message not modified" or similar errors
      if (error.data?.error === 'message_not_found') {
        return;
      }
      console.error('[SlackPlugin] Failed to edit message:', error);
      throw error;
    }
  }

  /**
   * Setup message and event handlers
   */
  private setupHandlers(): void {
    if (!this.app) return;

    // Handle messages in channels/DMs (not threads)
    this.app.message(async ({ message, say, client }) => {
      try {
        // Filter out bot messages and threaded messages
        if ((message as any).subtype || (message as any).thread_ts) {
          return;
        }

        await this.handleMessage(message);
      } catch (error) {
        console.error('[SlackPlugin] Error handling message:', error);
      }
    });

    // Handle app mentions (@bot)
    this.app.event('app_mention', async ({ event, say, client }) => {
      try {
        await this.handleMessage(event);
      } catch (error) {
        console.error('[SlackPlugin] Error handling app_mention:', error);
      }
    });

    // Handle button actions
    this.app.action(/^button_(.*)/, async ({ action, ack, body, client }) => {
      try {
        // Acknowledge the action
        await ack();

        await this.handleAction(action, body);
      } catch (error) {
        console.error('[SlackPlugin] Error handling action:', error);
      }
    });

    // Handle errors
    this.app.error(async (error) => {
      console.error('[SlackPlugin] App error:', error);
      this.setError(error.message || String(error));
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: any): Promise<void> {
    const userId = message.user;
    if (!userId) return;

    // Track user
    this.activeUsers.add(userId);

    try {
      // Convert to unified message and forward to handler
      const unifiedMessage = toUnifiedIncomingMessage(message);
      if (unifiedMessage && this.messageHandler) {
        // Process in background to avoid blocking
        void this.messageHandler(unifiedMessage).catch((error) => {
          console.error(`[SlackPlugin] Message handler failed:`, error);
        });
      } else {
        console.warn(`[SlackPlugin] Cannot forward message: unifiedMessage=${!!unifiedMessage}, messageHandler=${!!this.messageHandler}`);
      }
    } catch (error) {
      console.error(`[SlackPlugin] Error processing message:`, error);
    }
  }

  /**
   * Handle button action
   */
  private async handleAction(action: any, body: any): Promise<void> {
    const userId = body.user?.id;
    if (!userId) return;

    this.activeUsers.add(userId);

    try {
      const actionValue = action.value;
      const channel = body.channel?.id;

      // Parse action value
      const category = actionValue.split(':')[0];

      // Handle tool confirmation
      if (category === 'confirm') {
        const parts = actionValue.split(':');
        if (parts.length >= 3 && this.confirmHandler) {
          const callId = parts[1];
          const value = parts.slice(2).join(':');

          void this.confirmHandler(userId, 'slack', callId, value)
            .then(async () => {
              // Remove buttons after confirmation
              try {
                if (this.app && body.message?.ts && channel) {
                  await this.app.client.chat.update({
                    channel: channel,
                    ts: body.message.ts,
                    text: body.message.text || '',
                    blocks: [], // Remove all blocks (including buttons)
                  });
                }
              } catch (editError) {
                console.debug(`[SlackPlugin] Failed to remove buttons (ignored):`, editError);
              }
            })
            .catch((error) => console.error(`[SlackPlugin] Error handling confirm action:`, error));
        }
        return;
      }

      // Handle agent selection
      if (category === 'agent') {
        const agentType = parts[1];
        // Create a synthetic message for agent selection
        const syntheticMessage = {
          type: 'message',
          user: userId,
          channel: channel,
          ts: Date.now().toString(),
          text: `agent.select:${agentType}`,
        };

        const unifiedMessage = toUnifiedIncomingMessage(syntheticMessage);
        if (unifiedMessage && this.messageHandler) {
          unifiedMessage.content.type = 'action';
          unifiedMessage.content.text = 'agent.select';
          unifiedMessage.action = {
            type: 'system',
            name: 'agent.select',
            params: { agentType },
          };

          void this.messageHandler(unifiedMessage)
            .then(async () => {
              // Remove buttons after selection
              try {
                if (this.app && body.message?.ts && channel) {
                  await this.app.client.chat.update({
                    channel: channel,
                    ts: body.message.ts,
                    text: body.message.text || '',
                    blocks: [],
                  });
                }
              } catch (editError) {
                console.debug(`[SlackPlugin] Failed to remove buttons (ignored):`, editError);
              }
            })
            .catch((error) => console.error(`[SlackPlugin] Error handling agent selection:`, error));
        }
      }
    } catch (error) {
      console.error('[SlackPlugin] Error handling action:', error);
    }
  }

  /**
   * Test connection with provided credentials
   */
  static async testConnection(botToken: string, appToken: string): Promise<boolean> {
    try {
      const testApp = new App({
        token: botToken,
        appToken: appToken,
        socketMode: true,
        logLevel: LogLevel.ERROR,
      });

      // Test authentication
      const result = await testApp.client.auth.test();
      return result.ok === true;
    } catch (error) {
      console.error('[SlackPlugin] Connection test failed:', error);
      return false;
    }
  }
}
