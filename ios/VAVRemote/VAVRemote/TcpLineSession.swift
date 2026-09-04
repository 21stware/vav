import Darwin
import Foundation
import Tcmobile

/// JSON-lines socket to a loopback / LAN vavd. Same frames as the tailcat
/// path — iOS is a phone-protocol client, not a second host.
final class TcpLineSession {
    private let fd: Int32
    private var buffer = Data()
    private let lock = NSLock()

    private init(fd: Int32) {
        self.fd = fd
    }

    deinit {
        close()
    }

    static func connect(host: String, port: Int, timeoutSec: Int = 8) throws -> TcpLineSession {
        guard port > 0, port <= 65_535 else {
            throw NSError(domain: "vav.remote", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "无效端口"
            ])
        }
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        hints.ai_protocol = IPPROTO_TCP
        var result: UnsafeMutablePointer<addrinfo>?
        let err = getaddrinfo(host, String(port), &hints, &result)
        guard err == 0, let head = result else {
            throw NSError(domain: NSPOSIXErrorDomain, code: Int(err == 0 ? EHOSTUNREACH : err), userInfo: [
                NSLocalizedDescriptionKey: "找不到 \(host)"
            ])
        }
        defer { freeaddrinfo(head) }

        var lastErrno = errno
        var cursor: UnsafeMutablePointer<addrinfo>? = head
        while let info = cursor?.pointee {
            cursor = info.ai_next
            let fd = socket(info.ai_family, info.ai_socktype, info.ai_protocol)
            if fd < 0 {
                lastErrno = errno
                continue
            }
            var tv = timeval(tv_sec: timeoutSec, tv_usec: 0)
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
            var nodelay: Int32 = 1
            setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &nodelay, socklen_t(MemoryLayout<Int32>.size))
            let connected = Darwin.connect(fd, info.ai_addr, info.ai_addrlen)
            if connected == 0 {
                return TcpLineSession(fd: fd)
            }
            lastErrno = errno
            Darwin.close(fd)
        }
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(lastErrno), userInfo: [
            NSLocalizedDescriptionKey: "连不上 \(host):\(port)"
        ])
    }

    func writeLine(_ line: String) throws {
        var payload = line
        if !payload.hasSuffix("\n") { payload += "\n" }
        var data = Array(payload.utf8)
        lock.lock()
        defer { lock.unlock() }
        var sent = 0
        while sent < data.count {
            let n = data.withUnsafeBytes { raw -> Int in
                guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return Darwin.send(fd, base + sent, data.count - sent, 0)
            }
            if n <= 0 {
                throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [
                    NSLocalizedDescriptionKey: "写入失败"
                ])
            }
            sent += n
        }
    }

    func readLine(_ error: NSErrorPointer) -> String {
        while true {
            if let line = takeLine() { return line }
            var chunk = [UInt8](repeating: 0, count: 4096)
            let n = chunk.withUnsafeMutableBytes { raw -> Int in
                guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
                return Darwin.recv(fd, base, 4096, 0)
            }
            if n <= 0 {
                error?.pointee = NSError(
                    domain: NSPOSIXErrorDomain,
                    code: n == 0 ? Int(ECONNRESET) : Int(errno),
                    userInfo: [NSLocalizedDescriptionKey: "连接已断开"]
                )
                return ""
            }
            buffer.append(contentsOf: chunk.prefix(n))
        }
    }

    func close() {
        lock.lock()
        shutdown(fd, SHUT_RDWR)
        Darwin.close(fd)
        lock.unlock()
    }

    private func takeLine() -> String? {
        guard let idx = buffer.firstIndex(of: UInt8(ascii: "\n")) else { return nil }
        let slice = buffer.prefix(upTo: idx)
        buffer.removeSubrange(...idx)
        if slice.last == UInt8(ascii: "\r") {
            return String(bytes: slice.dropLast(), encoding: .utf8) ?? ""
        }
        return String(bytes: slice, encoding: .utf8) ?? ""
    }
}

enum LineTransport {
    case tunnel(TcmobileSession)
    case lan(TcpLineSession)

    func writeLine(_ line: String) throws {
        switch self {
        case .tunnel(let session): try session.writeLine(line)
        case .lan(let session): try session.writeLine(line)
        }
    }

    func readLine(_ error: NSErrorPointer) -> String {
        switch self {
        case .tunnel(let session): return session.readLine(error)
        case .lan(let session): return session.readLine(error)
        }
    }

    func close() {
        switch self {
        case .tunnel(let session): session.close()
        case .lan(let session): session.close()
        }
    }
}
