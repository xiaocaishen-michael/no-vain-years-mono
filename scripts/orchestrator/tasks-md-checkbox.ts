/**
 * Pure string transforms for tasks.md checkbox state.
 *
 * Per plan § 5.3.15.8.2:
 *   - flipCheckbox: `- [ ] T001 ...` → `- [X] T001 ...`
 *   - revertCheckbox: `- [X] T001 ...` → `- [ ] T001 ...`
 *
 * Both are idempotent: applying when already in the target state is a no-op.
 * `[x]` (lowercase) is normalized to `[X]` on flip to match the
 * task-closure preset convention.
 */

export class CheckboxNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`task ${taskId}: no checkbox line found in tasks.md`);
    this.name = 'CheckboxNotFoundError';
  }
}

/**
 * Match a checkbox line for a given task. Anchors to start-of-line so
 * a mention of `T001` in prose elsewhere isn't mistaken for the task line.
 * Captures: 1=indent, 2=current state ` `|`x`|`X`, 3=trailing text.
 */
function checkboxRegex(taskId: string): RegExp {
  const id = escapeRegExp(taskId);
  // ^(indent?)- \[(state)\] (taskId)(rest-of-line)
  return new RegExp(`^([ \\t]*)- \\[( |x|X)\\] (${id})\\b(.*)$`, 'm');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function flipCheckbox(content: string, taskId: string): string {
  const r = checkboxRegex(taskId);
  if (!r.test(content)) {
    throw new CheckboxNotFoundError(taskId);
  }
  return content.replace(r, (_full, indent, _state, id, rest) => {
    return `${indent}- [X] ${id}${rest}`;
  });
}

export function revertCheckbox(content: string, taskId: string): string {
  const r = checkboxRegex(taskId);
  if (!r.test(content)) {
    throw new CheckboxNotFoundError(taskId);
  }
  return content.replace(r, (_full, indent, _state, id, rest) => {
    return `${indent}- [ ] ${id}${rest}`;
  });
}

/** Returns the current state for diagnostics; throws if the task line is missing. */
export function getCheckboxState(
  content: string,
  taskId: string,
): 'pending' | 'completed' {
  const r = checkboxRegex(taskId);
  const m = content.match(r);
  if (!m) throw new CheckboxNotFoundError(taskId);
  return m[2] === ' ' ? 'pending' : 'completed';
}
