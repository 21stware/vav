/**
 * TypeScript / JavaScript AST → PreviewBlock tree (file-preview.rpml).
 * L1 type · L2 func/method · L3 control · L4 stmt.
 */
import ts from 'typescript'
import type { PreviewBlock } from '@shared/previewBlock'

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1
}

function rangeOf(sf: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number } {
  return {
    startLine: lineOf(sf, node.getStart(sf, false)),
    endLine: lineOf(sf, node.end)
  }
}

function sliceSource(sf: ts.SourceFile, node: ts.Node): string {
  return sf.text.slice(node.getStart(sf, false), node.end)
}

function nameOf(node: ts.NamedDeclaration): string {
  if (!node.name) return 'anonymous'
  return node.name.getText()
}

function isFunctionLikeInit(node: ts.Expression | undefined): boolean {
  if (!node) return false
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function controlKindLabel(node: ts.Node): string {
  if (ts.isIfStatement(node)) return 'if'
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    return 'for'
  }
  if (ts.isWhileStatement(node) || ts.isDoStatement(node)) return 'while'
  if (ts.isSwitchStatement(node)) return 'switch'
  if (ts.isTryStatement(node)) return 'try'
  if (ts.isWithStatement(node)) return 'with'
  return 'block'
}

function isControlStatement(node: ts.Node): boolean {
  return (
    ts.isIfStatement(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node)
  )
}

function stmtBlocks(sf: ts.SourceFile, statements: readonly ts.Statement[]): PreviewBlock[] {
  const out: PreviewBlock[] = []
  for (const stmt of statements) {
    if (ts.isBlock(stmt)) {
      out.push(...stmtBlocks(sf, stmt.statements))
      continue
    }
    const { startLine, endLine } = rangeOf(sf, stmt)
    const text = sliceSource(sf, stmt).trim()
    if (!text) continue
    out.push({
      id: `stmt-L${startLine}`,
      kind: 'stmt',
      text,
      startLine,
      endLine,
      label: `line ${startLine}`
    })
  }
  return out
}

function controlBlocksFromStatements(
  sf: ts.SourceFile,
  statements: readonly ts.Statement[]
): PreviewBlock[] {
  const out: PreviewBlock[] = []
  for (const stmt of statements) {
    collectControls(sf, stmt, out)
  }
  return out
}

function collectControls(sf: ts.SourceFile, node: ts.Node, out: PreviewBlock[]): void {
  if (isControlStatement(node)) {
    const { startLine, endLine } = rangeOf(sf, node)
    const kind = controlKindLabel(node)
    let bodyStmts: readonly ts.Statement[] = []
    if (ts.isIfStatement(node)) {
      bodyStmts = blockStatements(node.thenStatement)
    } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      bodyStmts = blockStatements(node.statement)
    } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      bodyStmts = blockStatements(node.statement)
    } else if (ts.isSwitchStatement(node)) {
      bodyStmts = node.caseBlock.clauses.flatMap((c) => c.statements)
    } else if (ts.isTryStatement(node)) {
      bodyStmts = [
        ...node.tryBlock.statements,
        ...(node.catchClause?.block.statements ?? []),
        ...(node.finallyBlock?.statements ?? [])
      ]
    }
    const nested = controlBlocksFromStatements(sf, bodyStmts)
    const stmts = stmtBlocks(sf, bodyStmts).filter(
      (s) => !nested.some((c) => s.startLine >= c.startLine && s.endLine <= c.endLine)
    )
    out.push({
      id: `block-${kind}-L${startLine}`,
      kind: 'control',
      text: sliceSource(sf, node),
      startLine,
      endLine,
      label: `${kind} · lines ${startLine}–${endLine}`,
      children: nested.length ? nested : stmts.length ? stmts : undefined
    })
    // Also walk else-branch of if as sibling control when present.
    if (ts.isIfStatement(node) && node.elseStatement) {
      if (ts.isIfStatement(node.elseStatement)) {
        collectControls(sf, node.elseStatement, out)
      } else {
        const elseRange = rangeOf(sf, node.elseStatement)
        const elseBody = blockStatements(node.elseStatement)
        const elseNested = controlBlocksFromStatements(sf, elseBody)
        const elseStmts = stmtBlocks(sf, elseBody)
        out.push({
          id: `block-else-L${elseRange.startLine}`,
          kind: 'control',
          text: sliceSource(sf, node.elseStatement),
          startLine: elseRange.startLine,
          endLine: elseRange.endLine,
          label: `else · lines ${elseRange.startLine}–${elseRange.endLine}`,
          children: elseNested.length ? elseNested : elseStmts.length ? elseStmts : undefined
        })
      }
    }
    return
  }

  ts.forEachChild(node, (child) => collectControls(sf, child, out))
}

function blockStatements(node: ts.Statement): readonly ts.Statement[] {
  if (ts.isBlock(node)) return node.statements
  return [node]
}

function functionBodyStatements(node: ts.FunctionLikeDeclaration): readonly ts.Statement[] {
  if (!node.body) return []
  if (ts.isBlock(node.body)) return node.body.statements
  return []
}

function funcBlock(
  sf: ts.SourceFile,
  node: ts.FunctionLikeDeclaration,
  name: string,
  language: string
): PreviewBlock {
  const { startLine, endLine } = rangeOf(sf, node)
  const body = functionBodyStatements(node)
  const controls = controlBlocksFromStatements(sf, body)
  return {
    id: `func-${name}-L${startLine}`,
    kind: 'func',
    text: sliceSource(sf, node),
    language,
    label: `func ${name} · lines ${startLine}–${endLine}`,
    startLine,
    endLine,
    children: controls.length ? controls : undefined
  }
}

function typeMembers(
  sf: ts.SourceFile,
  members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
  language: string
): PreviewBlock[] {
  const out: PreviewBlock[] = []
  for (const member of members) {
    if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      const name = ts.isConstructorDeclaration(member) ? 'constructor' : nameOf(member)
      out.push(funcBlock(sf, member, name, language))
    } else if (ts.isPropertyDeclaration(member) && isFunctionLikeInit(member.initializer)) {
      const init = member.initializer as ts.FunctionLikeDeclaration
      const { startLine, endLine } = rangeOf(sf, member)
      const name = nameOf(member)
      const body = functionBodyStatements(init)
      const controls = controlBlocksFromStatements(sf, body)
      out.push({
        id: `func-${name}-L${startLine}`,
        kind: 'func',
        text: sliceSource(sf, member),
        language,
        label: `func ${name} · lines ${startLine}–${endLine}`,
        startLine,
        endLine,
        children: controls.length ? controls : undefined
      })
    }
  }
  return out
}

function scriptKindForPath(path: string): ts.ScriptKind {
  const lower = path.toLowerCase()
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.TS
}

/**
 * Parse TS/JS source into hierarchical selectable blocks.
 * Throws if the file cannot be parsed as a SourceFile (rare).
 */
export function parseTsCodeBlocks(path: string, source: string): PreviewBlock[] {
  const language =
    /\.tsx?$/i.test(path) ? 'typescript' : /\.jsx?$/i.test(path) ? 'javascript' : 'typescript'
  const sf = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(path)
  )

  const blocks: PreviewBlock[] = []

  for (const stmt of sf.statements) {
    if (
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)
    ) {
      const { startLine, endLine } = rangeOf(sf, stmt)
      const kindLabel = ts.isClassDeclaration(stmt)
        ? 'class'
        : ts.isInterfaceDeclaration(stmt)
          ? 'interface'
          : ts.isEnumDeclaration(stmt)
            ? 'enum'
            : 'module'
      const name = nameOf(stmt as ts.NamedDeclaration)
      let children: PreviewBlock[] | undefined
      if (ts.isClassDeclaration(stmt) && stmt.members) {
        children = typeMembers(sf, stmt.members, language)
      } else if (ts.isInterfaceDeclaration(stmt)) {
        // Interfaces rarely have method bodies; expose signatures as funcs without children.
        children = stmt.members
          .filter((m) => ts.isMethodSignature(m) || ts.isCallSignatureDeclaration(m))
          .map((m) => {
            const { startLine: s, endLine: e } = rangeOf(sf, m)
            const n = ts.isMethodSignature(m) && m.name ? m.name.getText() : 'call'
            return {
              id: `func-${n}-L${s}`,
              kind: 'func' as const,
              text: sliceSource(sf, m),
              language,
              label: `func ${n} · lines ${s}–${e}`,
              startLine: s,
              endLine: e
            }
          })
      }
      blocks.push({
        id: `type-${name}-L${startLine}`,
        kind: 'type',
        text: sliceSource(sf, stmt),
        language,
        label: `${kindLabel} ${name}`,
        startLine,
        endLine,
        children: children?.length ? children : undefined
      })
      continue
    }

    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      blocks.push(funcBlock(sf, stmt, stmt.name.getText(), language))
      continue
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isFunctionLikeInit(decl.initializer)) {
          const { startLine, endLine } = rangeOf(sf, stmt)
          const name = decl.name.getText()
          const init = decl.initializer as ts.FunctionLikeDeclaration
          const body = functionBodyStatements(init)
          const controls = controlBlocksFromStatements(sf, body)
          blocks.push({
            id: `func-${name}-L${startLine}`,
            kind: 'func',
            text: sliceSource(sf, stmt),
            language,
            label: `func ${name} · lines ${startLine}–${endLine}`,
            startLine,
            endLine,
            children: controls.length ? controls : undefined
          })
        }
      }
      // If this statement produced funcs, skip paragraph fallback for it.
      const produced = blocks.some(
        (b) => b.startLine === rangeOf(sf, stmt).startLine && b.kind === 'func'
      )
      if (produced) continue
    }

    if (ts.isTypeAliasDeclaration(stmt)) {
      const { startLine, endLine } = rangeOf(sf, stmt)
      blocks.push({
        id: `type-${nameOf(stmt)}-L${startLine}`,
        kind: 'type',
        text: sliceSource(sf, stmt),
        language,
        label: `type ${nameOf(stmt)}`,
        startLine,
        endLine
      })
      continue
    }

    // Imports / misc top-level → small paragraph blocks (skip empty).
    const text = sliceSource(sf, stmt).trim()
    if (!text || ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      if (text && (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt))) {
        const { startLine, endLine } = rangeOf(sf, stmt)
        // Group later — for now one block per import is noisy; skip bare imports.
        if (ts.isImportDeclaration(stmt)) continue
        blocks.push({
          id: `para-L${startLine}`,
          kind: 'paragraph',
          text,
          language,
          startLine,
          endLine,
          label: `lines ${startLine}–${endLine}`
        })
      }
      continue
    }

    const { startLine, endLine } = rangeOf(sf, stmt)
    blocks.push({
      id: `para-L${startLine}`,
      kind: 'paragraph',
      text,
      language,
      startLine,
      endLine,
      label: `lines ${startLine}–${endLine}`
    })
  }

  if (blocks.length === 0 && source.trim()) {
    const lines = source.split(/\r?\n/).length
    return [
      {
        id: 'para-file',
        kind: 'paragraph',
        text: source,
        language,
        startLine: 1,
        endLine: Math.max(1, lines),
        label: `file · lines 1–${lines}`
      }
    ]
  }

  return blocks
}
