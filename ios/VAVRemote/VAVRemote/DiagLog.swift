import Foundation
import Network
import Tcmobile
import UIKit

/// Ring + file diagnostic log so a failed WAN dial can be exported from Settings.
enum DiagLog {
    private static let maxLines = 800
    private static let queue = DispatchQueue(label: "vav.remote.diag")
    private static var lines: [String] = []
    private static var monitor: NWPathMonitor?
    private static var lastPath = ""

    private static var fileURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("vav-remote-diag.log")
    }

    static func start() {
        queue.sync {
            if let existing = try? String(contentsOf: fileURL, encoding: .utf8), !existing.isEmpty {
                lines = existing.split(whereSeparator: \.isNewline).map(String.init)
                if lines.count > maxLines { lines = Array(lines.suffix(maxLines)) }
            }
        }
        line("diag start \(header())")
        startPathMonitor()
    }

    static func line(_ message: String) {
        let stamp = Self.stamp()
        let text = "\(stamp) \(redact(message))"
        queue.async {
            lines.append(text)
            if lines.count > maxLines { lines = Array(lines.suffix(maxLines)) }
            persistLocked()
        }
        NSLog("[vav-diag] %@", text)
    }

    static func ingestGo() {
        let go = TcmobileSnapshotLogs().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !go.isEmpty else { return }
        queue.sync {
            for raw in go.split(whereSeparator: \.isNewline) {
                let row = String(raw)
                if !lines.contains(where: { $0.hasSuffix(row) || $0.contains(row) }) {
                    lines.append("\(stamp()) [tc] \(redact(row))")
                }
            }
            if lines.count > maxLines { lines = Array(lines.suffix(maxLines)) }
            persistLocked()
        }
    }

    static func snapshot() -> String {
        ingestGo()
        return queue.sync {
            ([header(), ""] + lines).joined(separator: "\n")
        }
    }

    static func exportFile() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("vav-remote-diag.txt")
        try? snapshot().data(using: .utf8)?.write(to: url)
        return url
    }

    static func clear() {
        TcmobileClearLogs()
        queue.sync {
            lines = []
            persistLocked()
        }
        line("diag cleared")
    }

    private static func header() -> String {
        let device = UIDevice.current
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "VAV Remote \(version) (\(build)) iOS \(device.systemVersion) \(device.name) model=\(device.model)"
    }

    private static func startPathMonitor() {
        queue.async {
            guard monitor == nil else { return }
            let probe = NWPathMonitor()
            probe.pathUpdateHandler = { path in
                let summary = describe(path)
                queue.async {
                    guard summary != lastPath else { return }
                    lastPath = summary
                    line("path \(summary)")
                }
            }
            probe.start(queue: queue)
            monitor = probe
        }
    }

    private static func describe(_ path: NWPath) -> String {
        var kinds: [String] = []
        if path.usesInterfaceType(.wifi) { kinds.append("wifi") }
        if path.usesInterfaceType(.cellular) { kinds.append("cellular") }
        if path.usesInterfaceType(.wiredEthernet) { kinds.append("wired") }
        if path.usesInterfaceType(.other) { kinds.append("other") }
        if path.usesInterfaceType(.loopback) { kinds.append("loopback") }
        let status: String
        switch path.status {
        case .satisfied: status = "satisfied"
        case .unsatisfied: status = "unsatisfied"
        case .requiresConnection: status = "requiresConnection"
        @unknown default: status = "unknown"
        }
        return "\(status) via=\(kinds.joined(separator: "+")) expensive=\(path.isExpensive) constrained=\(path.isConstrained)"
    }

    private static func persistLocked() {
        try? lines.joined(separator: "\n").data(using: .utf8)?.write(to: fileURL)
    }

    private static func stamp() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: Date())
    }

    /// Drop pairing secrets / full tailcat tokens from anything we persist or share.
    static func redact(_ text: String) -> String {
        var out = text
        if let regex = try? NSRegularExpression(pattern: "tc[A-Za-z0-9_-]{10,}") {
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "tc…")
        }
        if let regex = try? NSRegularExpression(pattern: #""(secret|auth)"\s*:\s*"[^"]+""#) {
            let range = NSRange(out.startIndex..., in: out)
            out = regex.stringByReplacingMatches(in: out, range: range, withTemplate: "\"$1\":\"…\"")
        }
        return out
    }

    static func tokenHint(_ token: String) -> String {
        if token.count <= 8 { return "len=\(token.count)" }
        return "\(token.prefix(6))… len=\(token.count)"
    }
}
