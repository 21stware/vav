import Foundation
import Security

/// Keychain-backed pairing book. The QR secret gates the whole tunnel,
/// so it never lands in UserDefaults or app files. One item holds every
/// paired computer; older installs stored a single `Pairing` at this key
/// and are migrated on first read.
enum PairingStore {
    private static let service = "com.vav.remote.pairing"
    private static let account = "default"

    static func loadBook() -> PairingBook {
        guard let data = loadData() else { return PairingBook() }
        if let book = try? JSONDecoder().decode(PairingBook.self, from: data) {
            return PairingBook(pairings: book.pairings, activeToken: book.activeToken)
        }
        if let pairing = try? JSONDecoder().decode(Pairing.self, from: data) {
            return PairingBook(pairings: [pairing], activeToken: pairing.token)
        }
        return PairingBook()
    }

    static func save(_ book: PairingBook) {
        let normalized = PairingBook(pairings: book.pairings, activeToken: book.activeToken)
        guard let data = try? JSONEncoder().encode(normalized) else { return }
        write(data)
    }

    static func load() -> Pairing? {
        loadBook().active
    }

    static func save(_ pairing: Pairing) {
        var book = loadBook()
        book.upsert(pairing)
        book.activate(pairing.token)
        save(book)
    }

    static func clear() {
        deleteItem()
    }

    private static func loadData() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else {
            return nil
        }
        return result as? Data
    }

    private static func write(_ data: Data) {
        deleteItem()
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecValueData as String: data
        ]
        SecItemAdd(item as CFDictionary, nil)
    }

    private static func deleteItem() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}
