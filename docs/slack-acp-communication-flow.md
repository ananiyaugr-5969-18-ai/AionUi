# Slack ACP Communication Flow

This document explains how Slack ACP (Anthropic Claude Protocol) communication works in AionUi, starting from when a user types 'copilot --acp' in Slack.

## Current Status

**Important:** Slack integration is planned but not yet fully implemented. The architecture and flow described below represent the intended design based on existing patterns from Telegram, Lark, and DingTalk implementations.

## Architecture Overview

```mermaid
graph TB
    subgraph "Slack Platform"
        User[User types 'copilot --acp<br/>Write hello world']
        SlackAPI[Slack API/WebSocket]
    end

    subgraph "AionUi Desktop App"
        subgraph "Channel System"
            SlackPlugin[SlackPlugin]
            SlackAdapter[SlackAdapter]
            ChannelManager[ChannelManager<br/>Singleton]
            PairingService[PairingService<br/>6-digit codes]
            SessionManager[SessionManager<br/>Per-user sessions]
            ActionExecutor[ActionExecutor<br/>Message Router]
            ChannelMessageService[ChannelMessageService<br/>Streaming Control]
            ChannelEventBus[ChannelEventBus<br/>Global Event System]
        end

        subgraph "Worker Process"
            AcpAgentManager[AcpAgentManager]
            AcpAgent[AcpAgent]
            AcpConnection[AcpConnection<br/>stdio JSON-RPC]
        end

        subgraph "Database"
            DB[(SQLite Database)]
        end

        subgraph "Desktop UI"
            RendererUI[Renderer Process<br/>Chat Interface]
        end
    end

    subgraph "External CLI"
        CLI[copilot --acp<br/>or claude --acp<br/>or qwen --acp]
    end

    User -->|Message| SlackAPI
    SlackAPI -->|WebSocket/Webhook| SlackPlugin
    SlackPlugin -->|IUnifiedIncomingMessage| SlackAdapter
    SlackAdapter -->|Normalized Message| ActionExecutor
    ActionExecutor -->|Check Auth| PairingService
    PairingService -->|6-digit code| SlackPlugin
    SlackPlugin -->|Display code| User
    ActionExecutor -->|Get/Create| SessionManager
    SessionManager -->|Store| DB
    ActionExecutor -->|Send Message| ChannelMessageService
    ChannelMessageService -->|Create Task| AcpAgentManager
    AcpAgentManager -->|Fork Process| AcpAgent
    AcpAgent -->|JSON-RPC| AcpConnection
    AcpConnection <-->|stdio| CLI
    CLI -->|Stream Updates| AcpConnection
    AcpConnection -->|onStreamEvent| AcpAgent
    AcpAgent -->|Broadcast| ChannelEventBus
    AcpAgent -->|IPC| RendererUI
    ChannelEventBus -->|Event| ChannelMessageService
    ChannelMessageService -->|Callback| ActionExecutor
    ActionExecutor -->|Update/Edit| SlackPlugin
    SlackPlugin -->|Message| SlackAPI
    SlackAPI -->|Display| User

    style SlackPlugin fill:#e1f5ff
    style AcpAgent fill:#ffe1e1
    style ChannelEventBus fill:#fff4e1
    style CLI fill:#e1ffe1
```

## Detailed Flow: User Message to AI Response

### Phase 1: User Authorization & Session Setup

```mermaid
sequenceDiagram
    participant User
    participant Slack
    participant SlackPlugin
    participant ActionExecutor
    participant PairingService
    participant SessionManager
    participant DB
    participant ConversationService

    User->>Slack: Types 'copilot --acp<br/>Write hello world'
    Slack->>SlackPlugin: WebSocket event
    SlackPlugin->>SlackPlugin: SlackAdapter converts<br/>to IUnifiedIncomingMessage
    SlackPlugin->>ActionExecutor: handleIncomingMessage()

    ActionExecutor->>PairingService: Check authorization

    alt User NOT authorized
        PairingService->>PairingService: Generate 6-digit code<br/>(10 min expiry)
        PairingService->>DB: Store pairing_code
        PairingService->>ActionExecutor: Code created
        ActionExecutor->>SlackPlugin: sendMessage(code)
        SlackPlugin->>Slack: Display code
        Slack->>User: "Use code 123456<br/>in AionUi Settings"
        Note over User: User approves in AionUi app
        PairingService->>DB: Update assistant_users
        Note over ActionExecutor: Wait for next message
    else User authorized
        ActionExecutor->>SessionManager: getSession(userId, chatId)

        alt No session exists
            SessionManager->>ConversationService: createConversation({<br/>type:'acp',<br/>backend:'copilot',<br/>source:'slack',<br/>channelChatId: chatId})
            ConversationService->>DB: INSERT conversations
            ConversationService-->>SessionManager: conversationId
            SessionManager->>DB: INSERT assistant_sessions
            SessionManager-->>ActionExecutor: New session created
        else Session exists
            SessionManager-->>ActionExecutor: Existing conversationId
        end

        ActionExecutor->>ActionExecutor: Parse message<br/>Extract: backend='copilot'<br/>Text: 'Write hello world'
        Note over ActionExecutor: Continue to Phase 2
    end
```

### Phase 2: Message Streaming Setup

```mermaid
sequenceDiagram
    participant ActionExecutor
    participant SlackPlugin
    participant ChannelMessageService
    participant ChannelEventBus
    participant WorkerManage
    participant AcpAgentManager

    ActionExecutor->>SlackPlugin: sendMessage("⏳ Thinking...")
    SlackPlugin-->>ActionExecutor: thinkingMsgId

    ActionExecutor->>ChannelMessageService: initialize()
    ChannelMessageService->>ChannelEventBus: Register listener<br/>onAgentMessage()

    ActionExecutor->>ChannelMessageService: sendMessage(<br/>sessionId,<br/>conversationId,<br/>"Write hello world",<br/>onStreamCallback)

    ChannelMessageService->>WorkerManage: getTaskByIdRollbackBuild(<br/>conversationId,<br/>{yoloMode: true})

    WorkerManage->>AcpAgentManager: Create manager instance
    AcpAgentManager->>AcpAgentManager: Resolve backend config<br/>backend='copilot'<br/>cliPath='/usr/local/bin/copilot'<br/>args=['--acp', '--stdio']

    Note over AcpAgentManager: Continue to Phase 3
```

### Phase 3: ACP Agent Execution

```mermaid
sequenceDiagram
    participant AcpAgentManager
    participant AcpWorker as ACP Worker<br/>(Fork Process)
    participant AcpAgent
    participant AcpConnection
    participant CLI as copilot CLI<br/>(--acp)

    AcpAgentManager->>AcpWorker: Fork process<br/>src/worker/acp.ts
    AcpWorker->>AcpAgent: new AcpAgent(config)
    AcpAgent->>AcpConnection: Create connection
    AcpConnection->>CLI: spawn('copilot', ['--acp', '--stdio'])
    CLI-->>AcpConnection: Process started

    AcpConnection->>CLI: JSON-RPC Request<br/>{method:'session/initialize'}
    CLI-->>AcpConnection: {result:{sessionId:'...', capabilities:[...]}}
    AcpConnection-->>AcpAgent: Session initialized
    AcpAgent-->>AcpAgentManager: onSessionIdUpdate(sessionId)
    AcpAgentManager->>AcpAgentManager: Save session ID for resume

    AcpAgentManager->>AcpAgent: sendMessage("Write hello world")
    AcpAgent->>AcpConnection: Format message
    AcpConnection->>CLI: JSON-RPC Request<br/>{method:'user/submit_message',<br/>params:{text:'Write hello world'}}

    Note over CLI: AI processes request

    CLI-->>AcpConnection: JSON-RPC Notification<br/>{method:'session/update',<br/>params:{update:{<br/>sessionUpdate:'agent_message_chunk',<br/>content:{type:'text',<br/>text:'I will create...'}}}}

    AcpConnection-->>AcpAgent: onMessage(chunk)
    Note over AcpAgent: Continue to Phase 4
```

### Phase 4: Dual Broadcasting & Streaming

```mermaid
sequenceDiagram
    participant AcpAgent
    participant IPC as IPC Bridge
    participant RendererUI as Desktop UI
    participant ChannelEventBus
    participant ChannelMessageService
    participant ActionExecutor
    participant SlackPlugin
    participant Slack
    participant User

    loop For each streaming chunk
        AcpAgent->>AcpAgent: onStreamEvent(data)

        par Dual Broadcasting
            AcpAgent->>IPC: conversationMessage.emit(message)
            IPC->>RendererUI: Update chat interface
            RendererUI->>RendererUI: Display message chunk
        and
            AcpAgent->>ChannelEventBus: emitAgentMessage(<br/>conversationId, data)
            ChannelEventBus->>ChannelMessageService: Listener catches event
            ChannelMessageService->>ChannelMessageService: transformMessage()<br/>composeMessage()
            ChannelMessageService->>ActionExecutor: onStream(message, isInsert)
        end

        ActionExecutor->>ActionExecutor: Throttle (500ms timer)

        alt First chunk (insert)
            ActionExecutor->>SlackPlugin: editMessage(<br/>thinkingMsgId,<br/>"I will create...")
        else Subsequent chunks (update)
            ActionExecutor->>SlackPlugin: editMessage(<br/>thinkingMsgId,<br/>"I will create...\n\nHere's the code:\n...")
        end

        SlackPlugin->>Slack: Update message via API
        Slack->>User: Display updated response
    end

    Note over AcpAgent: Stream complete<br/>finishCount >= turnCount
    ChannelMessageService->>ChannelMessageService: Resolve stream promise
    ActionExecutor->>ActionExecutor: Clear throttle timer
    ActionExecutor->>SlackPlugin: editMessage with action buttons<br/>[↻ Regenerate] [✂️ Copy]
    SlackPlugin->>Slack: Final message
    Slack->>User: Display complete response
```

### Phase 5: Tool Confirmation (If Required)

```mermaid
sequenceDiagram
    participant CLI as copilot CLI
    participant AcpConnection
    participant AcpAgent
    participant ChannelEventBus
    participant ActionExecutor
    participant SlackAdapter
    participant SlackPlugin
    participant Slack
    participant User

    CLI->>AcpConnection: JSON-RPC Request<br/>{method:'user/tool_confirmation',<br/>params:{callId:'123',<br/>tool:'bash',<br/>command:'rm -rf /'}}

    AcpConnection->>AcpAgent: handlePermissionRequest(request)
    AcpAgent->>ChannelEventBus: emitAgentMessage(<br/>type:'acp_permission')
    ChannelEventBus->>ActionExecutor: Event received

    ActionExecutor->>SlackAdapter: createToolConfirmationMarkup(<br/>tool, command)
    SlackAdapter-->>ActionExecutor: Slack button blocks
    ActionExecutor->>SlackPlugin: sendMessage with buttons:<br/>✅ Allow Once<br/>✅ Always Allow<br/>❌ Cancel

    SlackPlugin->>Slack: Interactive message
    Slack->>User: Display confirmation card

    User->>Slack: Clicks "❌ Cancel"
    Slack->>SlackPlugin: Action callback
    SlackPlugin->>ActionExecutor: User action received
    ActionExecutor->>ChannelMessageService: confirm(conversationId,<br/>callId, 'deny')

    ChannelMessageService->>AcpAgent: confirm(callId, 'deny')
    AcpAgent->>AcpConnection: Format confirmation
    AcpConnection->>CLI: JSON-RPC Response<br/>{result:{approved:false}}

    CLI->>CLI: Handle denial
    CLI->>AcpConnection: Continue with alternative
    Note over AcpConnection: Stream continues...
```

## Component Architecture

### Key Components

```mermaid
graph TB
    subgraph "Channel Manager (Orchestrator)"
        CM[ChannelManager]
        PM[PluginManager]
        SM[SessionManager]
        PS[PairingService]
        AE[ActionExecutor]
    end

    subgraph "Plugin Layer"
        BP[BasePlugin<br/>Abstract]
        SP[SlackPlugin<br/>extends BasePlugin]
        SA[SlackAdapter<br/>Format Converter]
    end

    subgraph "Message Service"
        CMS[ChannelMessageService<br/>Singleton]
        CEB[ChannelEventBus<br/>EventEmitter]
    end

    subgraph "Worker Layer"
        WM[WorkerManage]
        AAM[AcpAgentManager]
        GAM[GeminiAgentManager]
        CAM[CodexAgentManager]
    end

    CM --> PM
    CM --> SM
    CM --> PS
    CM --> AE
    PM --> SP
    SP --> SA
    SP -.implements.- BP
    AE --> CMS
    CMS --> CEB
    CMS --> WM
    WM --> AAM
    WM --> GAM
    WM --> CAM
    AAM --> CEB

    style CM fill:#e1f5ff
    style CEB fill:#fff4e1
    style AAM fill:#ffe1e1
```

### Plugin Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> created: new SlackPlugin()
    created --> initializing: start()
    initializing --> ready: Credentials validated
    initializing --> error: Validation failed
    ready --> starting: connect()
    starting --> running: Connected to Slack
    starting --> error: Connection failed
    running --> stopping: stop()
    stopping --> stopped: Disconnected
    stopped --> starting: start()
    error --> initializing: retry()
    error --> [*]: permanent failure
    stopped --> [*]
```

### Session & Conversation Isolation

```mermaid
graph TB
    subgraph "User A"
        UA[Slack User U123456]
        UA1[DM: 'user:U123456']
        UA2[Channel: 'channel:C111111']
        UA3[Channel: 'channel:C222222']
    end

    subgraph "User B"
        UB[Slack User U789012]
        UB1[DM: 'user:U789012']
        UB2[Channel: 'channel:C111111']
    end

    subgraph "Sessions (userId:chatId)"
        S1[Session: U123456:user:U123456]
        S2[Session: U123456:channel:C111111]
        S3[Session: U123456:channel:C222222]
        S4[Session: U789012:user:U789012]
        S5[Session: U789012:channel:C111111]
    end

    subgraph "Conversations"
        C1[Conv 1: ACP/Claude<br/>source=slack<br/>chat_id=user:U123456]
        C2[Conv 2: Gemini<br/>source=slack<br/>chat_id=channel:C111111]
        C3[Conv 3: ACP/Copilot<br/>source=slack<br/>chat_id=channel:C222222]
        C4[Conv 4: ACP/Qwen<br/>source=slack<br/>chat_id=user:U789012]
        C5[Conv 5: Gemini<br/>source=slack<br/>chat_id=channel:C111111]
    end

    UA1 --> S1
    UA2 --> S2
    UA3 --> S3
    UB1 --> S4
    UB2 --> S5

    S1 --> C1
    S2 --> C2
    S3 --> C3
    S4 --> C4
    S5 --> C5

    style S2 fill:#fff4e1
    style S5 fill:#fff4e1
    style C2 fill:#ffe1e1
    style C5 fill:#ffe1e1

    Note1[Note: Users A & B in same channel<br/>have separate conversations]
```

## Data Flow: Message Types

### Incoming Message Flow

```mermaid
graph LR
    A[Slack Event] -->|Raw JSON| B[SlackPlugin]
    B -->|Parse| C[SlackAdapter]
    C -->|Transform| D[IUnifiedIncomingMessage]
    D -->|Route| E[ActionExecutor]
    E -->|Decode| F{Message Type}
    F -->|text| G[handleChatMessage]
    F -->|command| H[executeAction]
    F -->|action| I[handleCallback]

    style D fill:#e1f5ff
```

### Outgoing Message Flow

```mermaid
graph LR
    A[TMessage<br/>from AI] -->|Transform| B[composeMessage]
    B --> C[IUnifiedOutgoingMessage]
    C -->|Format| D[SlackAdapter]
    D -->|Block Kit| E[SlackPlugin]
    E -->|Slack API| F[Message in Slack]

    style C fill:#e1ffe1
```

## Database Schema

### Tables & Relationships

```mermaid
erDiagram
    assistant_plugins ||--o{ assistant_users : manages
    assistant_users ||--o{ assistant_sessions : has
    assistant_sessions ||--|| conversations : uses
    assistant_plugins ||--o{ assistant_pairing_codes : generates

    assistant_plugins {
        TEXT id PK
        TEXT type "slack|telegram|lark|dingtalk"
        TEXT name
        INTEGER enabled
        TEXT config "JSON credentials"
        TEXT status
        INTEGER last_connected
        INTEGER created_at
        INTEGER updated_at
    }

    assistant_users {
        TEXT id PK
        TEXT platform_user_id "Slack User ID U123456"
        TEXT platform_type "slack"
        TEXT display_name
        INTEGER authorized_at
        INTEGER last_active
        TEXT session_id
    }

    assistant_sessions {
        TEXT id PK
        TEXT user_id FK
        TEXT agent_type "acp|gemini|codex"
        TEXT conversation_id FK
        TEXT workspace
        TEXT chat_id "user:U123456 or channel:C123456"
        INTEGER created_at
        INTEGER last_activity
    }

    conversations {
        TEXT id PK
        TEXT type "acp|gemini|codex"
        TEXT source "slack|telegram|lark"
        TEXT channel_chat_id
        TEXT extra "JSON with backend config"
    }

    assistant_pairing_codes {
        TEXT code PK "6-digit"
        TEXT platform_user_id
        TEXT platform_type
        TEXT display_name
        INTEGER requested_at
        INTEGER expires_at
        TEXT status "pending|approved|rejected|expired"
    }
```

## ACP Backend Support

### Supported Backends

```mermaid
graph TB
    ACP[ACP Protocol]

    ACP --> C[Claude<br/>--experimental-acp]
    ACP --> Q[Qwen<br/>--acp]
    ACP --> CO[Copilot<br/>--acp --stdio]
    ACP --> IF[iFlow<br/>--experimental-acp]
    ACP --> G[Goose<br/>acp]
    ACP --> A[Auggie<br/>--acp]
    ACP --> K[Kimi<br/>--acp]
    ACP --> OC[OpenCode<br/>acp]
    ACP --> CB[CodeBuddy<br/>--acp]
    ACP --> D[Droid<br/>exec --output-format acp]
    ACP --> V[Vibe<br/>--acp]
    ACP --> N[NanoBot<br/>--acp]
    ACP --> CU[Custom<br/>user-configured]

    style ACP fill:#e1f5ff
    style C fill:#ffe1e1
    style CO fill:#fff4e1
    style Q fill:#e1ffe1
```

## Security & Authorization

### Pairing Flow

```mermaid
sequenceDiagram
    participant User
    participant Slack
    participant PairingService
    participant AionUiApp as AionUi App<br/>(Settings UI)
    participant DB

    User->>Slack: First message to bot
    Slack->>PairingService: User not authorized
    PairingService->>PairingService: Generate random 6-digit code
    PairingService->>DB: INSERT pairing_code<br/>expires_at = now + 10min
    PairingService->>Slack: Send code to user
    Slack->>User: "Use code 123456 in AionUi"

    User->>AionUiApp: Open Settings → Channels<br/>View pending pairings
    AionUiApp->>DB: SELECT * FROM pairing_codes<br/>WHERE status='pending'
    DB-->>AionUiApp: Show code 123456 + user info

    alt User approves
        User->>AionUiApp: Click "Approve"
        AionUiApp->>DB: INSERT assistant_users
        AionUiApp->>DB: UPDATE pairing_code<br/>SET status='approved'
        AionUiApp->>Slack: Send notification<br/>"✅ Authorized!"
        Slack->>User: Can now use bot
    else User rejects
        User->>AionUiApp: Click "Reject"
        AionUiApp->>DB: UPDATE pairing_code<br/>SET status='rejected'
        AionUiApp->>Slack: Send notification<br/>"❌ Access denied"
    else Code expires
        Note over PairingService: After 10 minutes
        PairingService->>DB: UPDATE pairing_code<br/>SET status='expired'
    end
```

## Performance Optimizations

### Message Throttling

```mermaid
sequenceDiagram
    participant AcpAgent
    participant ChannelMessageService
    participant ActionExecutor
    participant SlackPlugin

    loop Every streaming chunk (potentially 100/sec)
        AcpAgent->>ChannelMessageService: Stream chunk
        ChannelMessageService->>ActionExecutor: onStream callback

        alt First chunk
            ActionExecutor->>ActionExecutor: Start 500ms timer
            ActionExecutor->>SlackPlugin: editMessage (immediate)
            Note over ActionExecutor: Set pendingUpdate = true
        else Subsequent chunks (within 500ms)
            ActionExecutor->>ActionExecutor: Buffer message
            Note over ActionExecutor: Don't send yet
        end

        Note over ActionExecutor: 500ms passes
        ActionExecutor->>ActionExecutor: Timer fires

        alt Has buffered updates
            ActionExecutor->>SlackPlugin: editMessage (batched)
            ActionExecutor->>ActionExecutor: Reset timer
        end
    end

    Note over AcpAgent: Stream complete
    ActionExecutor->>ActionExecutor: Clear timer
    ActionExecutor->>SlackPlugin: editMessage (final, guaranteed)
```

## Implementation Status

### Current State

```mermaid
graph TB
    subgraph "✅ Implemented"
        T[Telegram Plugin]
        L[Lark Plugin]
        DT[DingTalk Plugin]
        CM[ChannelManager]
        PS[PairingService]
        SM[SessionManager]
        AE[ActionExecutor]
        CMS[ChannelMessageService]
        CEB[ChannelEventBus]
        AAM[AcpAgentManager]
        DB[Database Schema]
    end

    subgraph "🚧 Not Yet Implemented"
        SP[SlackPlugin]
        SA[SlackAdapter]
        SC[SlackCards]
        SUI[Settings UI for Slack]
    end

    subgraph "📋 Required for Slack"
        SP2[SlackPlugin Implementation]
        SA2[Message Format Conversion]
        WS[WebSocket/Webhook Handler]
        BK[Block Kit Formatter]
    end

    T -.reference.- SP2
    L -.reference.- SP2
    SA2 --> SP2
    WS --> SP2
    BK --> SA2

    style T fill:#90EE90
    style CM fill:#90EE90
    style DB fill:#90EE90
    style SP fill:#FFB6C1
    style SA fill:#FFB6C1
    style SP2 fill:#87CEEB
```

## Key Files & Responsibilities

| File Path | Purpose |
|-----------|---------|
| `src/channels/core/ChannelManager.ts` | Orchestrator, lifecycle management |
| `src/channels/gateway/ActionExecutor.ts` | Message routing, AI processing |
| `src/channels/agent/ChannelMessageService.ts` | Streaming control, flow management |
| `src/channels/agent/ChannelEventBus.ts` | Global event bus (agent→channel) |
| `src/channels/pairing/PairingService.ts` | Authorization, pairing codes |
| `src/channels/plugins/BasePlugin.ts` | Plugin abstraction layer |
| `src/process/task/AcpAgentManager.ts` | ACP agent lifecycle, dual broadcasting |
| `src/worker/acp.ts` | Fork wrapper, stdio communication |
| `src/agent/acp/index.ts` | AcpAgent class, ACP protocol implementation |
| `src/types/acpTypes.ts` | ACP backend definitions, type system |

## References

- **ACP Specification**: [Anthropic Claude Protocol](https://docs.anthropic.com/en/docs/acp)
- **Existing Implementations**:
  - `src/channels/plugins/telegram/TelegramPlugin.ts`
  - `src/channels/plugins/lark/LarkPlugin.ts`
  - `src/channels/plugins/dingtalk/DingTalkPlugin.ts`
- **Database Schema**: `src/process/database/migrations.ts`

---

**Document Version**: 1.0
**Last Updated**: 2026-02-28
**Status**: Architecture documented, Slack implementation pending
