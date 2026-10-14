import Foundation

/// Length-prefixed JSON frames for the Accessibility harness's private pipes.
enum Frames {
    static let maximum = 64 * 1024 * 1024

    static func read(from handle: FileHandle) throws -> [String: Any]? {
        func exact(_ count: Int, allowEOF: Bool = false) throws -> Data? {
            var bytes = Data()
            while bytes.count < count {
                let next = try handle.read(upToCount: count - bytes.count) ?? Data()
                if next.isEmpty {
                    if allowEOF && bytes.isEmpty { return nil }
                    throw NSError(domain: "Frames", code: 1)
                }
                bytes.append(next)
            }
            return bytes
        }
        guard let header = try exact(4, allowEOF: true) else { return nil }
        let size = header.enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
        guard size > 0, size <= maximum, let body = try exact(Int(size)),
              let packet = try JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw NSError(domain: "Frames", code: 2)
        }
        return packet
    }

    static func write(_ packet: [String: Any], to handle: FileHandle, limit: Int = maximum) throws {
        let body = try JSONSerialization.data(withJSONObject: packet)
        guard body.count <= limit else { throw NSError(domain: "Frames", code: 3) }
        let size = UInt32(body.count)
        try handle.write(contentsOf: Data((0..<4).map { UInt8((size >> ($0 * 8)) & 255) }) + body)
    }
}
