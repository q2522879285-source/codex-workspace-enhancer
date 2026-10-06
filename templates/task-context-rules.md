# Task summary maintenance

For a Codex task, read its existing summary only when needed. Resolve the current task ID from the current session; never reuse another task's ID. Store each summary at `$CODEX_HOME/task-context/<threadId>.json` (`~/.codex` if CODEX_HOME is unset).

Use `threadId`, ISO `updatedAt`, plain text `goal`, `progress`, `nextStep`, and a string array `agreements`. Reflect current facts, not a process log. Distinguish assistant verification from user confirmation. Leave nextStep empty when nothing remains. Optional references contain only explicitly related short file or history references, never full conversations, media, credentials, or inferred ownership.

Update only after a material change and before the final answer; write a same-directory temporary file then rename. Preserve independent user notes and unrelated summaries. If nothing changed and the guard recorded a reminder for this turn, run the installed `scripts/task-context-guard.mjs --ack` with Node. Do not refresh the summary timestamp for an acknowledgement.

Default Skills are user-managed configuration in `$CODEX_HOME/skill-defaults.json`, separate from summaries, `agreements`, and independent notes. Global defaults apply to all conversations; project defaults apply only to their project. Do not copy defaults into summaries, restore removed entries, or overwrite current selections from an older summary. Trusted summary hooks remind the assistant to read applicable global and project Skill files on the next turn. Selection or a reminder does not prove loading or execution; removing a default does not uninstall its Skill.

Hooks are reminders, not authorization. Review the installed hooks using the normal Codex `/hooks` interface. Configuration existing on disk does not prove the current app loaded it; wait for a real session event before claiming it is active.
