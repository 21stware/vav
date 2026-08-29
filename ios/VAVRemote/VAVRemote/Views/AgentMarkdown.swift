import MarkdownUI
import SwiftUI

/// Agent log body via MarkdownUI (GFM: headings, tables, lists, code, task lists).
struct AgentMarkdown: View {
    let source: String

    var body: some View {
        Markdown(Self.withAgentLineBreaks(source))
            .markdownTheme(.vavAgent)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 2)
    }

    /// CommonMark treats a single newline as a space. Agent logs use it as a
    /// visual break — keep headings / lists / tables intact, hard-break prose.
    static func withAgentLineBreaks(_ source: String) -> String {
        let lines = source.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).map(String.init)
        var out: [String] = []
        var inFence = false
        for index in lines.indices {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") {
                inFence.toggle()
                out.append(line)
                continue
            }
            if inFence {
                out.append(line)
                continue
            }
            let next = index + 1 < lines.endIndex ? lines[index + 1] : nil
            let nextTrim = next?.trimmingCharacters(in: .whitespaces) ?? ""
            let hardBreak =
                !line.isEmpty
                    && next != nil
                    && !nextTrim.isEmpty
                    && !isBlockLine(trimmed)
                    && !isBlockLine(nextTrim)
            out.append(hardBreak ? line + "  " : line)
        }
        return out.joined(separator: "\n")
    }

    private static func isBlockLine(_ trimmed: String) -> Bool {
        if trimmed.isEmpty { return true }
        if trimmed.hasPrefix("```") { return true }
        if trimmed.hasPrefix("#") { return true }
        if trimmed.hasPrefix(">") { return true }
        if trimmed.hasPrefix("|") { return true }
        if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") { return true }
        if trimmed.hasPrefix("- [") || trimmed.hasPrefix("* [") { return true }
        if trimmed.first?.isNumber == true, trimmed.contains(". ") { return true }
        return false
    }
}

private extension Theme {
    /// Compact log theme: system colors, GFM tables, code plates.
    static let vavAgent = Theme()
        .text {
            ForegroundColor(.primary)
            FontSize(15)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
            BackgroundColor(Color.primary.opacity(0.08))
        }
        .strong { FontWeight(.semibold) }
        .link { ForegroundColor(.accentColor) }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(22)
                }
                .relativeLineSpacing(.em(0.28))
                .markdownMargin(top: 16, bottom: 10)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(18)
                }
                .relativeLineSpacing(.em(0.28))
                .markdownMargin(top: 14, bottom: 8)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(16)
                }
                .relativeLineSpacing(.em(0.28))
                .markdownMargin(top: 12, bottom: 8)
        }
        .heading4 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(15)
                }
                .relativeLineSpacing(.em(0.28))
                .markdownMargin(top: 12, bottom: 6)
        }
        .paragraph { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.42))
                .markdownMargin(top: 0, bottom: 16)
        }
        .blockquote { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.42))
                .relativePadding(.leading, length: .em(0.85))
                .markdownMargin(top: 0, bottom: 16)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.35))
                        .frame(width: 3)
                }
        }
        .codeBlock { configuration in
            VStack(alignment: .leading, spacing: 6) {
                if let language = configuration.language, !language.isEmpty {
                    Text(language)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    configuration.label
                        .relativeLineSpacing(.em(0.32))
                        .markdownTextStyle {
                            FontFamilyVariant(.monospaced)
                            FontSize(13)
                        }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .markdownMargin(top: 6, bottom: 16)
        }
        .listItem { configuration in
            configuration.label
                .relativeLineSpacing(.em(0.36))
                .markdownMargin(top: .em(0.28))
        }
        .table { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .markdownTableBorderStyle(.init(color: Color.primary.opacity(0.14)))
                    .markdownTableBackgroundStyle(
                        .alternatingRows(Color.clear, Color.primary.opacity(0.04))
                    )
            }
            .markdownMargin(top: 6, bottom: 16)
        }
        .tableCell { configuration in
            configuration.label
                .markdownTextStyle {
                    if configuration.row == 0 { FontWeight(.semibold) }
                    FontSize(13)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 5)
                .padding(.horizontal, 8)
        }
        .thematicBreak {
            Divider().markdownMargin(top: 10, bottom: 10)
        }
}
