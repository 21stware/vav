/**
 * Office lock / owner stubs are not real packages.
 *
 * Word: `~$name.docx` (or `.~$name.docx`). LibreOffice / some editors:
 * `.~name.docx`. Do **not** treat bare `~name.docx` as a lock — real user
 * files can start with `~` (e.g. `~优品开题报告.docx`); those open if they
 * are valid ZIP packages (checked at read time).
 */
export function isOfficeLockFile(path: string): boolean {
  const name = path.split(/[/\\]/).pop() ?? path
  if (name.startsWith('~$') || name.startsWith('.~$')) return true
  // Leading-dot owner files: ".~报告.docx"
  if (name.startsWith('.~') && /\.(docx|xlsx|pptx)$/i.test(name)) return true
  return false
}

export const OFFICE_LOCK_FILE_MESSAGE =
  'This is an Office temporary lock file (~$… / .~…), not the real document. Close Word’s lock stub and open the original .docx/.xlsx/.pptx.'
