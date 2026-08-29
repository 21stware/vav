import Foundation

/// Wire types mirroring `src/shared/remoteControl.ts` (JSON lines, proto 1).
enum RemoteProto {
    static let version = 1
}

enum RemoteTab: Hashable {
    case sessions, notifications, settings
}

struct RemoteSession: Decodable, Identifiable, Equatable, Hashable {
    let id: String
    let title: String
    let dirLabel: String
    let status: String // running | done | idle
    let surface: String // vav | cli
    let updatedAt: Double
    let preview: String?
    let workdir: String?
    let temporary: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, dirLabel, status, surface, updatedAt, preview, workdir, temporary
    }

    init(
        id: String,
        title: String,
        dirLabel: String,
        status: String,
        surface: String,
        updatedAt: Double,
        preview: String?,
        workdir: String? = nil,
        temporary: Bool = false
    ) {
        self.id = id
        self.title = title
        self.dirLabel = dirLabel
        self.status = status
        self.surface = surface
        self.updatedAt = updatedAt
        self.preview = preview
        self.workdir = workdir
        self.temporary = temporary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        dirLabel = try c.decodeIfPresent(String.self, forKey: .dirLabel) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "idle"
        surface = try c.decodeIfPresent(String.self, forKey: .surface) ?? "vav"
        updatedAt = try c.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        preview = try c.decodeIfPresent(String.self, forKey: .preview)
        workdir = try c.decodeIfPresent(String.self, forKey: .workdir)
        temporary = try c.decodeIfPresent(Bool.self, forKey: .temporary) ?? false
    }

    func patching(
        status: String? = nil,
        preview: String? = nil,
        updatedAt: Double? = nil,
        title: String? = nil,
        dirLabel: String? = nil,
        workdir: String? = nil,
        temporary: Bool? = nil
    ) -> RemoteSession {
        RemoteSession(
            id: id,
            title: title ?? self.title,
            dirLabel: dirLabel ?? self.dirLabel,
            status: status ?? self.status,
            surface: surface,
            updatedAt: updatedAt ?? self.updatedAt,
            preview: preview ?? self.preview,
            workdir: workdir ?? self.workdir,
            temporary: temporary ?? self.temporary
        )
    }
}

struct RemotePlanStep: Codable, Equatable, Hashable {
    let text: String
    let done: Bool
}

struct RemoteThreadBlock: Codable, Equatable {
    let kind: String
    let text: String?
    let id: String?
    let tool: String?
    let name: String?
    let summary: String?
    let status: String?
    let title: String?
    let prompt: String?
    let steps: [RemotePlanStep]?
    let choices: [RemoteChoice]?
    let multiSelect: Bool?

    var stableId: String { id ?? "\(kind)-\(summary ?? title ?? text ?? "")" }

    init(
        kind: String,
        text: String? = nil,
        id: String? = nil,
        tool: String? = nil,
        name: String? = nil,
        summary: String? = nil,
        status: String? = nil,
        title: String? = nil,
        prompt: String? = nil,
        steps: [RemotePlanStep]? = nil,
        choices: [RemoteChoice]? = nil,
        multiSelect: Bool? = nil
    ) {
        self.kind = kind
        self.text = text
        self.id = id
        self.tool = tool
        self.name = name
        self.summary = summary
        self.status = status
        self.title = title
        self.prompt = prompt
        self.steps = steps
        self.choices = choices
        self.multiSelect = multiSelect
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = (try? c.decode(String.self, forKey: .kind)) ?? ""
        text = try? c.decodeIfPresent(String.self, forKey: .text) ?? nil
        id = try? c.decodeIfPresent(String.self, forKey: .id) ?? nil
        tool = try? c.decodeIfPresent(String.self, forKey: .tool) ?? nil
        name = try? c.decodeIfPresent(String.self, forKey: .name) ?? nil
        summary = try? c.decodeIfPresent(String.self, forKey: .summary) ?? nil
        status = try? c.decodeIfPresent(String.self, forKey: .status) ?? nil
        title = try? c.decodeIfPresent(String.self, forKey: .title) ?? nil
        prompt = try? c.decodeIfPresent(String.self, forKey: .prompt) ?? nil
        steps = try? c.decodeIfPresent([RemotePlanStep].self, forKey: .steps) ?? nil
        choices = try? c.decodeIfPresent([RemoteChoice].self, forKey: .choices) ?? nil
        multiSelect = try? c.decodeIfPresent(Bool.self, forKey: .multiSelect) ?? nil
    }

    enum CodingKeys: String, CodingKey {
        case kind, text, id, tool, name, summary, status, title, prompt, steps, choices, multiSelect
    }
}

struct RemoteThreadMessage: Codable, Identifiable, Equatable {
    let id: String
    let role: String
    let text: String
    let at: Double
    let blocks: [RemoteThreadBlock]?
    let cancelled: Bool?
    let error: String?

    init(
        id: String,
        role: String,
        text: String,
        at: Double,
        blocks: [RemoteThreadBlock]? = nil,
        cancelled: Bool? = nil,
        error: String? = nil
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.at = at
        self.blocks = blocks
        self.cancelled = cancelled
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = try c.decodeIfPresent(String.self, forKey: .role) ?? "assistant"
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        at = try c.decodeIfPresent(Double.self, forKey: .at) ?? 0
        blocks = (try? c.decodeIfPresent([RemoteThreadBlock].self, forKey: .blocks)) ?? nil
        cancelled = try c.decodeIfPresent(Bool.self, forKey: .cancelled)
        error = try c.decodeIfPresent(String.self, forKey: .error)
    }

    enum CodingKeys: String, CodingKey {
        case id, role, text, at, blocks, cancelled, error
    }
}

struct RemoteChoice: Codable, Identifiable, Equatable, Hashable {
    let id: String
    let label: String
}

struct RemoteSessionControls: Codable, Equatable {
    let conversationId: String
    let agentLocked: Bool
    let agent: String
    let agents: [RemoteChoice]
    let model: String
    let models: [RemoteChoice]
    let thinking: String?
    let thinkingLevels: [RemoteChoice]
    let mode: String?
    let modes: [RemoteChoice]
    let approval: String
    let approvals: [RemoteChoice]
    let fast: Bool?
    let workingDirectory: String
    let dirLabel: String
    let temporary: Bool

    enum CodingKeys: String, CodingKey {
        case conversationId, agentLocked, agent, agents, model, models
        case thinking, thinkingLevels, mode, modes, approval, approvals
        case fast, workingDirectory, dirLabel, temporary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversationId = try c.decode(String.self, forKey: .conversationId)
        agentLocked = try c.decodeIfPresent(Bool.self, forKey: .agentLocked) ?? false
        agent = try c.decodeIfPresent(String.self, forKey: .agent) ?? "vav"
        agents = try c.decodeIfPresent([RemoteChoice].self, forKey: .agents) ?? []
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        models = try c.decodeIfPresent([RemoteChoice].self, forKey: .models) ?? []
        thinking = try c.decodeIfPresent(String.self, forKey: .thinking)
        thinkingLevels = try c.decodeIfPresent([RemoteChoice].self, forKey: .thinkingLevels) ?? []
        mode = try c.decodeIfPresent(String.self, forKey: .mode)
        modes = try c.decodeIfPresent([RemoteChoice].self, forKey: .modes) ?? []
        approval = try c.decodeIfPresent(String.self, forKey: .approval) ?? "auto"
        approvals = try c.decodeIfPresent([RemoteChoice].self, forKey: .approvals) ?? []
        fast = try c.decodeIfPresent(Bool.self, forKey: .fast)
        workingDirectory = try c.decodeIfPresent(String.self, forKey: .workingDirectory) ?? ""
        dirLabel = try c.decodeIfPresent(String.self, forKey: .dirLabel) ?? ""
        temporary = try c.decodeIfPresent(Bool.self, forKey: .temporary) ?? false
    }

    func label(in rows: [RemoteChoice], id: String?, fallback: String) -> String {
        rows.first(where: { $0.id == id })?.label ?? fallback
    }
}

struct RemoteNotificationItem: Codable, Identifiable, Equatable {
    var id: String { "\(conversationId)-\(at)" }
    let kind: String // turn-complete | ask | approval | request
    let conversationId: String
    let title: String
    let body: String
    let at: Double

    var kindLabel: String {
        switch kind {
        case "turn-complete": return "完成"
        case "ask": return "提问"
        case "approval": return "待批准"
        case "request": return "请求"
        default: return kind
        }
    }
}

struct RemoteHostSnapshot: Codable, Equatable {
    struct Caps: Codable, Equatable {
        let cancel: Bool
        let reply: Bool
        let rename: Bool
        let archive: Bool
        let workdirPick: Bool
        let attachments: Bool
        let pty: Bool
        let spawn: Bool
        let fsRead: Bool
        let keys: Bool
    }
    struct Defaults: Codable, Equatable {
        let agent: String
        let model: String
        let thinking: String?
        let approval: String
    }
    struct RecentDir: Codable, Equatable, Identifiable {
        var id: String { path }
        let path: String
        let label: String
    }
    let name: String
    let home: String
    let tmp: String
    let platform: String?
    let capabilities: Caps
    let defaults: Defaults
    let recentDirs: [RecentDir]
}

struct RemoteTurn: Codable, Equatable {
    let conversationId: String
    let phase: String
    let draft: String?
    let thinking: String?
    let blocks: [RemoteThreadBlock]?
    let awaiting: RemoteThreadBlock?
    let error: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversationId = try c.decode(String.self, forKey: .conversationId)
        phase = try c.decodeIfPresent(String.self, forKey: .phase) ?? "running"
        draft = try? c.decodeIfPresent(String.self, forKey: .draft) ?? nil
        thinking = try? c.decodeIfPresent(String.self, forKey: .thinking) ?? nil
        blocks = (try? c.decodeIfPresent([RemoteThreadBlock].self, forKey: .blocks)) ?? nil
        awaiting = try? c.decodeIfPresent(RemoteThreadBlock.self, forKey: .awaiting) ?? nil
        error = try? c.decodeIfPresent(String.self, forKey: .error) ?? nil
    }

    enum CodingKeys: String, CodingKey {
        case conversationId, phase, draft, thinking, blocks, awaiting, error
    }
}

struct RemoteDirEntry: Codable, Equatable, Identifiable {
    var id: String { path }
    let name: String
    let path: String
}

struct RemoteDirs: Codable, Equatable {
    let conversationId: String
    let path: String
    let parent: String?
    let entries: [RemoteDirEntry]
}

/// Pairing payload scanned from the Mac's settings QR (`vav-remote:{…}`).
struct Pairing: Codable, Equatable {
    let v: Int
    let token: String
    let secret: String
    let host: String?

    static func parse(_ text: String) -> Pairing? {
        let prefix = "vav-remote:"
        guard text.hasPrefix(prefix),
              let data = text.dropFirst(prefix.count).data(using: .utf8),
              let pairing = try? JSONDecoder().decode(Pairing.self, from: data),
              pairing.token.hasPrefix("tc"),
              pairing.secret.count >= 16
        else { return nil }
        return pairing
    }
}

// --- inbound frames (server → phone) ---

enum ServerFrame {
    case welcome(app: String, version: String)
    case host(RemoteHostSnapshot)
    case sessions([RemoteSession])
    case thread(conversationId: String, messages: [RemoteThreadMessage])
    case controls(RemoteSessionControls)
    case turn(RemoteTurn)
    case dirs(RemoteDirs)
    case notification(RemoteNotificationItem)
    case sent(conversationId: String)
    case created(RemoteSession)
    case error(code: String, message: String, conversationId: String?)
    case pong

    static func parse(_ line: String) -> ServerFrame? {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String
        else { return nil }
        let decoder = JSONDecoder()
        switch type {
        case "welcome":
            return .welcome(
                app: object["app"] as? String ?? "?",
                version: object["version"] as? String ?? "?"
            )
        case "host":
            guard let host = try? decoder.decode(RemoteHostSnapshot.self, from: data) else { return nil }
            return .host(host)
        case "sessions":
            guard let raw = object["sessions"],
                  let payload = try? JSONSerialization.data(withJSONObject: raw),
                  let sessions = try? decoder.decode([RemoteSession].self, from: payload)
            else { return nil }
            return .sessions(sessions)
        case "thread":
            guard let conversationId = object["conversationId"] as? String,
                  let raw = object["messages"],
                  let payload = try? JSONSerialization.data(withJSONObject: raw),
                  let messages = try? decoder.decode([RemoteThreadMessage].self, from: payload)
            else { return nil }
            return .thread(conversationId: conversationId, messages: messages)
        case "controls":
            guard let controls = try? decoder.decode(RemoteSessionControls.self, from: data)
            else { return nil }
            return .controls(controls)
        case "turn":
            guard let turn = try? decoder.decode(RemoteTurn.self, from: data) else { return nil }
            return .turn(turn)
        case "dirs":
            guard let dirs = try? decoder.decode(RemoteDirs.self, from: data) else { return nil }
            return .dirs(dirs)
        case "notification":
            guard let item = try? decoder.decode(RemoteNotificationItem.self, from: data)
            else { return nil }
            return .notification(item)
        case "sent":
            return .sent(conversationId: object["conversationId"] as? String ?? "")
        case "created":
            guard let raw = object["session"],
                  let payload = try? JSONSerialization.data(withJSONObject: raw),
                  let session = try? decoder.decode(RemoteSession.self, from: payload)
            else { return nil }
            return .created(session)
        case "error":
            return .error(
                code: object["code"] as? String ?? "unknown",
                message: object["message"] as? String ?? "",
                conversationId: object["conversationId"] as? String
            )
        case "pong":
            return .pong
        default:
            return nil
        }
    }
}

// --- outbound frames (phone → server) ---

enum ClientFrame {
    static func encode(_ object: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8)
        else { return nil }
        return text
    }

    static func hello(secret: String, device: String) -> String? {
        encode(["type": "hello", "proto": RemoteProto.version, "auth": secret, "device": device])
    }

    static func send(conversationId: String, text: String, images: [[String: String]] = []) -> String? {
        var object: [String: Any] = ["type": "send", "conversationId": conversationId, "text": text]
        if !images.isEmpty { object["images"] = images }
        return encode(object)
    }

    static func sessions() -> String? { encode(["type": "sessions"]) }
    static func create() -> String? { encode(["type": "create"]) }
    static func thread(conversationId: String) -> String? {
        encode(["type": "thread", "conversationId": conversationId])
    }
    static func controls(conversationId: String) -> String? {
        encode(["type": "controls", "conversationId": conversationId])
    }
    static func configure(conversationId: String, patch: [String: String]) -> String? {
        var object: [String: Any] = ["type": "configure", "conversationId": conversationId]
        for (key, value) in patch { object[key] = value }
        return encode(object)
    }
    static func ping() -> String? { encode(["type": "ping"]) }
    static func cancel(conversationId: String) -> String? {
        encode(["type": "cancel", "conversationId": conversationId])
    }
    static func reply(conversationId: String, toolCallId: String, answer: String) -> String? {
        encode(["type": "reply", "conversationId": conversationId, "toolCallId": toolCallId, "answer": answer])
    }
    static func rename(conversationId: String, title: String) -> String? {
        encode(["type": "rename", "conversationId": conversationId, "title": title])
    }
    static func archive(conversationId: String) -> String? {
        encode(["type": "archive", "conversationId": conversationId])
    }
    static func browse(conversationId: String, path: String? = nil) -> String? {
        var object: [String: Any] = ["type": "browse", "conversationId": conversationId]
        if let path { object["path"] = path }
        return encode(object)
    }
    static func workspace(conversationId: String, path: String? = nil, temp: Bool = false) -> String? {
        var object: [String: Any] = ["type": "workspace", "conversationId": conversationId]
        if let path { object["path"] = path }
        if temp { object["temp"] = true }
        return encode(object)
    }
}
