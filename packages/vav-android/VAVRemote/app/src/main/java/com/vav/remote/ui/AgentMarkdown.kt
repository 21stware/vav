package com.vav.remote.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Agent log body via GFM (headings, tables, lists, code, task lists) —
 * same surface as iOS `AgentMarkdown` / MarkdownUI.
 */
@Composable
fun AgentMarkdown(source: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        parseAgentMarkdown(withAgentLineBreaks(source)).forEach { node ->
            when (node) {
                is MdNode.Heading -> Text(
                    inlineMarkdown(node.text),
                    style = when (node.level) {
                        1 -> MaterialTheme.typography.headlineSmall
                        2 -> MaterialTheme.typography.titleLarge
                        3 -> MaterialTheme.typography.titleMedium
                        else -> MaterialTheme.typography.titleSmall
                    },
                    fontWeight = FontWeight.SemiBold
                )
                is MdNode.Paragraph -> Text(inlineMarkdown(node.text), style = MaterialTheme.typography.bodyLarge)
                is MdNode.Quote -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(
                        modifier = Modifier
                            .padding(vertical = 2.dp)
                            .width(3.dp)
                            .heightIn(min = 18.dp)
                            .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.35f))
                    )
                    Text(
                        inlineMarkdown(node.text),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                is MdNode.Code -> Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            MaterialTheme.colorScheme.onSurface.copy(alpha = 0.05f),
                            RoundedCornerShape(10.dp)
                        )
                        .padding(12.dp)
                ) {
                    if (!node.language.isNullOrBlank()) {
                        Text(
                            node.language,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Text(
                        node.text,
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp
                    )
                }
                is MdNode.ListBlock -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    node.items.forEachIndexed { index, item ->
                        val mark = when {
                            item.checked == true -> "☑"
                            item.checked == false -> "☐"
                            node.ordered -> "${index + 1}."
                            else -> "•"
                        }
                        Text(buildAnnotatedString {
                            append("$mark ")
                            append(inlineMarkdown(item.text))
                        })
                    }
                }
                is MdNode.Table -> Row(Modifier.horizontalScroll(rememberScrollState())) {
                    Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                        TableRow(node.headers, header = true)
                        HorizontalDivider(color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.14f))
                        node.rows.forEach { row -> TableRow(row, header = false) }
                    }
                }
                MdNode.ThematicBreak -> HorizontalDivider(
                    modifier = Modifier.padding(vertical = 4.dp),
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.16f)
                )
            }
        }
    }
}

@Composable
private fun TableRow(cells: List<String>, header: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        cells.forEach { cell ->
            Text(
                inlineMarkdown(cell),
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 13.sp
            )
        }
    }
}

/** CommonMark treats a single newline as a space. Agent logs use it as a visual break. */
fun withAgentLineBreaks(source: String): String {
    val lines = source.split('\n')
    val out = ArrayList<String>(lines.size)
    var inFence = false
    for (index in lines.indices) {
        val line = lines[index]
        val trimmed = line.trim()
        if (trimmed.startsWith("```")) {
            inFence = !inFence
            out.add(line)
            continue
        }
        if (inFence) {
            out.add(line)
            continue
        }
        val next = lines.getOrNull(index + 1)
        val nextTrim = next?.trim().orEmpty()
        val hardBreak = line.isNotEmpty() &&
            next != null &&
            nextTrim.isNotEmpty() &&
            !isBlockLine(trimmed) &&
            !isBlockLine(nextTrim)
        out.add(if (hardBreak) "$line  " else line)
    }
    return out.joinToString("\n")
}

internal fun isBlockLine(trimmed: String): Boolean {
    if (trimmed.isEmpty()) return true
    if (trimmed.startsWith("```")) return true
    if (trimmed.startsWith("#")) return true
    if (trimmed.startsWith(">")) return true
    if (trimmed.startsWith("|")) return true
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) return true
    if (trimmed.startsWith("- [") || trimmed.startsWith("* [")) return true
    if (trimmed.firstOrNull()?.isDigit() == true && trimmed.contains(". ")) return true
    return false
}

internal sealed class MdNode {
    data class Heading(val level: Int, val text: String) : MdNode()
    data class Paragraph(val text: String) : MdNode()
    data class Quote(val text: String) : MdNode()
    data class Code(val language: String?, val text: String) : MdNode()
    data class ListBlock(val items: List<MdListItem>, val ordered: Boolean) : MdNode()
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MdNode()
    data object ThematicBreak : MdNode()
}

internal data class MdListItem(val text: String, val checked: Boolean? = null)

internal fun parseAgentMarkdown(source: String): List<MdNode> {
    val lines = source.split('\n')
    val nodes = mutableListOf<MdNode>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        if (trimmed.isEmpty()) {
            i += 1
            continue
        }
        if (trimmed == "---" || trimmed == "***" || trimmed == "___") {
            nodes.add(MdNode.ThematicBreak)
            i += 1
            continue
        }
        if (trimmed.startsWith("```")) {
            val language = trimmed.removePrefix("```").trim().ifBlank { null }
            val body = mutableListOf<String>()
            i += 1
            while (i < lines.size && !lines[i].trim().startsWith("```")) {
                body.add(lines[i])
                i += 1
            }
            if (i < lines.size) i += 1
            nodes.add(MdNode.Code(language, body.joinToString("\n")))
            continue
        }
        if (trimmed.startsWith("|") && i + 1 < lines.size && isTableSep(lines[i + 1].trim())) {
            val headers = splitTableRow(trimmed)
            i += 2
            val rows = mutableListOf<List<String>>()
            while (i < lines.size && lines[i].trim().startsWith("|")) {
                rows.add(splitTableRow(lines[i].trim()))
                i += 1
            }
            nodes.add(MdNode.Table(headers, rows))
            continue
        }
        val heading = headingOf(trimmed)
        if (heading != null) {
            nodes.add(heading)
            i += 1
            continue
        }
        if (trimmed.startsWith(">")) {
            val quoted = mutableListOf<String>()
            while (i < lines.size && lines[i].trim().startsWith(">")) {
                quoted.add(lines[i].trim().removePrefix(">").trimStart())
                i += 1
            }
            nodes.add(MdNode.Quote(quoted.joinToString("\n")))
            continue
        }
        val list = listStart(trimmed)
        if (list != null) {
            val items = mutableListOf<MdListItem>()
            val ordered = list.ordered
            while (i < lines.size) {
                val item = listStart(lines[i].trim()) ?: break
                if (item.ordered != ordered) break
                items.add(MdListItem(item.text, item.checked))
                i += 1
            }
            nodes.add(MdNode.ListBlock(items, ordered))
            continue
        }
        val para = mutableListOf<String>()
        while (i < lines.size) {
            val next = lines[i]
            val nextTrim = next.trim()
            if (nextTrim.isEmpty() || isBlockLine(nextTrim) && !looksLikeProse(nextTrim)) break
            para.add(next)
            i += 1
        }
        nodes.add(MdNode.Paragraph(para.joinToString("\n").trimEnd()))
    }
    return nodes
}

private fun looksLikeProse(trimmed: String): Boolean {
    return trimmed.isNotEmpty() &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("```") &&
        !trimmed.startsWith(">") &&
        !trimmed.startsWith("|") &&
        listStart(trimmed) == null &&
        trimmed != "---" &&
        trimmed != "***"
}

private fun headingOf(trimmed: String): MdNode.Heading? {
    val match = Regex("^(#{1,6})\\s+(.+)$").find(trimmed) ?: return null
    return MdNode.Heading(match.groupValues[1].length, match.groupValues[2])
}

private data class ListStart(val text: String, val ordered: Boolean, val checked: Boolean?)

private fun listStart(trimmed: String): ListStart? {
    val task = Regex("^[-*+]\\s+\\[([ xX])]\\s+(.*)$").find(trimmed)
    if (task != null) {
        return ListStart(task.groupValues[2], ordered = false, checked = task.groupValues[1].equals("x", true))
    }
    val bullet = Regex("^[-*+]\\s+(.+)$").find(trimmed)
    if (bullet != null) return ListStart(bullet.groupValues[1], ordered = false, checked = null)
    val ordered = Regex("^\\d+\\.\\s+(.+)$").find(trimmed) ?: return null
    return ListStart(ordered.groupValues[1], ordered = true, checked = null)
}

private fun isTableSep(trimmed: String): Boolean {
    if (!trimmed.startsWith("|")) return false
    return trimmed.split('|').filter { it.isNotBlank() }.all { cell ->
        cell.trim().matches(Regex("^:?-+:?$"))
    }
}

private fun splitTableRow(trimmed: String): List<String> {
    return trimmed.trim().trim('|').split('|').map { it.trim() }
}

internal fun inlineMarkdown(source: String): AnnotatedString = buildAnnotatedString {
    val pattern = Regex(
        """(\*\*[^*]+?\*\*|__[^_]+?__|\*[^*]+?\*|`[^`]+?`|\[[^\]]+]\([^)]+\))"""
    )
    var cursor = 0
    for (match in pattern.findAll(source)) {
        if (match.range.first > cursor) append(source.substring(cursor, match.range.first))
        val token = match.value
        when {
            token.startsWith("**") || token.startsWith("__") -> append(
                AnnotatedString(token.drop(2).dropLast(2), SpanStyle(fontWeight = FontWeight.SemiBold))
            )
            token.startsWith("*") -> append(
                AnnotatedString(token.drop(1).dropLast(1), SpanStyle(fontStyle = FontStyle.Italic))
            )
            token.startsWith("`") -> append(
                AnnotatedString(
                    token.drop(1).dropLast(1),
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        background = androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.08f)
                    )
                )
            )
            token.startsWith("[") -> {
                val label = token.substringAfter('[').substringBefore(']')
                append(AnnotatedString(label, SpanStyle(fontWeight = FontWeight.Medium)))
            }
            else -> append(token)
        }
        cursor = match.range.last + 1
    }
    if (cursor < source.length) append(source.substring(cursor))
}
