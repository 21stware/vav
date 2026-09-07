package com.vav.remote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vav.remote.RemoteThreadBlock

@Composable
fun AgentBlockStack(
    blocks: List<RemoteThreadBlock>,
    onReply: (toolCallId: String, answer: String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        blocks.forEach { block ->
            when (block.kind) {
                "reasoning" -> if (!block.text.isNullOrBlank()) ThinkingBlock(block.text)
                "tool" -> ToolRow(block)
                "plan" -> PlanBlock(block)
                "awaiting" -> AwaitingCard(block, onReply)
                else -> if (!block.text.isNullOrBlank()) AgentMarkdown(block.text)
            }
        }
    }
}

@Composable
fun ThinkingBlock(text: String) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        TextButton(onClick = { open = !open }) { Text("Thinking") }
        if (open) Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun ToolRow(block: RemoteThreadBlock) {
    Column(Modifier.fillMaxWidth()) {
        Text(block.name?.ifBlank { null } ?: block.tool ?: "tool", style = MaterialTheme.typography.labelLarge)
        if (!block.summary.isNullOrBlank()) {
            Text(block.summary, style = MaterialTheme.typography.bodySmall)
        }
        if (!block.status.isNullOrBlank()) {
            Text(block.status, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
fun PlanBlock(block: RemoteThreadBlock) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(block.title?.ifBlank { "Plan" } ?: "Plan", style = MaterialTheme.typography.labelLarge)
        block.steps.forEach { step ->
            Text("${if (step.done) "✓" else "○"} ${step.text}")
        }
    }
}

@Composable
fun AwaitingCard(block: RemoteThreadBlock, onReply: (toolCallId: String, answer: String) -> Unit) {
    var custom by remember { mutableStateOf("") }
    val toolCallId = block.id.orEmpty()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(block.title?.ifBlank { "需要确认" } ?: "需要确认", style = MaterialTheme.typography.titleSmall)
        if (!block.prompt.isNullOrBlank()) {
            Text(block.prompt, style = MaterialTheme.typography.bodyMedium)
        }
        if (block.choices.isNotEmpty()) {
            block.choices.forEach { choice ->
                FilterChip(
                    selected = false,
                    onClick = { if (toolCallId.isNotBlank()) onReply(toolCallId, choice.id) },
                    label = { Text(choice.label.ifBlank { choice.id }) }
                )
            }
        } else {
            OutlinedTextField(
                value = custom,
                onValueChange = { custom = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("回复") }
            )
            TextButton(
                onClick = { if (toolCallId.isNotBlank() && custom.isNotBlank()) onReply(toolCallId, custom) },
                enabled = custom.isNotBlank()
            ) { Text("发送") }
        }
    }
}
