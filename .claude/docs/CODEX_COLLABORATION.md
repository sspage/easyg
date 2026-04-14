# Claude + Codex Collaboration Guide

This document describes how Claude can collaborate with OpenAI Codex for autonomous code review and iteration workflows.

## Overview

Codex is an AI code assistant available in this environment that can perform thorough code reviews. Claude can invoke Codex programmatically using its non-interactive `exec` mode, allowing for an autonomous write-review-fix cycle.

## How to Invoke Codex

### Non-Interactive Mode (Required)

Codex requires a TTY for interactive mode, which isn't available when Claude runs commands. Use the `exec` subcommand instead:

```bash
codex exec -s read-only "Your prompt here" 2>/dev/null
```

**CRITICAL: Do NOT use `cd` to change directories before running Codex.** Using `cd` breaks autonomous execution because it requires user approval. Just run `codex exec` directly - it will work from the current working directory and find the repo root automatically.

**Important flags:**
- `-s read-only` - **CRITICAL:** Prevents Codex from modifying any files. Without this, Codex may attempt to "fix" issues it finds.
- `2>/dev/null` - Suppresses stderr noise to minimize context window consumption.

Optional: Append `2>codex-review.log` - to review the analysis later without consuming context.


### Running in Background

Codex reviews are thorough and can take **5-10 minutes**. Always run in background mode:

```bash
# Run with background: true and timeout: 600000 (10 minutes)
codex exec -s read-only "Review the uncommitted changes in this repository. Provide a code review with any issues, suggestions, or concerns." 2>/dev/null
```

**CRITICAL: Never kill a Codex process early.** Let it complete its full analysis.

## Configuration

Configure model and reasoning effort in `~/.codex/config.toml`:

```toml
model = "gpt-5.1-codex-mini"
model_reasoning_effort = "high"
```

**Reasoning Effort Levels:**
- `low` - Fastest, less thorough
- `medium` - Default balance
- `high` - Most thorough, catches more edge cases (recommended for code review)

You can also override per-command:
```bash
codex exec -c model="gpt-5.1-codex-mini" -c model_reasoning_effort="high" -s read-only "prompt"
```

## Code Review Workflow

### Step 1: Initial Review

For general reviews, DO NOT ATTEMPT TO RESTRICT Codex on what Claude might want to know.  Codex needs to do an independent review without any bias on what files to look at or what scenario to focus on:

Ask Codex to review uncommitted changes:

```bash
codex exec -s read-only "Review the uncommitted changes in this repository. Provide a code review with any issues, suggestions, or concerns." 2>/dev/null
```

For focused reviews, specify the scope:

```bash
codex exec -s read-only "Review the uncommitted changes in this repository. Focus on the files in [path/to/files]. Provide a code review with any issues, suggestions, or concerns." 2>/dev/null
```

### Step 2: Monitor Progress

Check the background process output periodically using `BashOutput`. Codex will show:
- `thinking` blocks - its analysis process
- `exec` blocks - commands it runs to examine the code
- Final `codex` block - the actual review findings

### Step 3: Analyze Findings

Codex findings typically include:
- **File path and line numbers** - e.g., `ai-search/indexers/file.js:26-33`
- **Issue description** - what's wrong
- **Suggested fix** - how to resolve it

### Step 4: Implement Fixes

For each finding:
1. Read the relevant file section
2. Understand the issue
3. Implement the fix
4. Track progress in todo list

### Step 5: Verify Fixes

Run Codex again to verify all issues are resolved:

```bash
codex exec -s read-only "Review the uncommitted changes in this repository. Focus on [area]. Provide a code review with any issues, suggestions, or concerns." 2>/dev/null
```

### Step 6: Iterate Until Clean

Repeat Steps 3-5 until Codex finds no new bugs. Note that Codex may report:
- **Bugs** - actual issues that need fixing
- **Design suggestions** - valid observations that are intentional design choices

Use judgment to distinguish between bugs requiring fixes and suggestions for future consideration.

**CRITICAL: This is a fully autonomous loop.**

- Do NOT report progress to the user mid-cycle
- Do NOT present summaries or ask what to do next until the review is clean
- Do NOT engage the user in discussion about findings - just fix them
- The work is NOT "done" until Codex returns a clean review
- Only report to user when: (1) review is clean, or (2) you genuinely need user input on a design decision

**Why this matters:** Engaging the user before getting a clean review wastes their time. If you present a summary and then Codex finds more bugs on the next review, the user's feedback was premature. Complete the full iteration cycle autonomously, then report success.

## Sample Prompts

### General Code Review
```
Review the uncommitted changes in this repository. Provide a code review with any issues, suggestions, or concerns.
```

### Focused Review
```
Review the uncommitted changes in this repository. Focus on the files in src/components/. Provide a code review with any issues, suggestions, or concerns.
```

### Security Review
```
Review the uncommitted changes for security vulnerabilities. Focus on authentication, input validation, and data handling.
```

### Architecture Review
```
Review the uncommitted changes for architectural concerns. Focus on separation of concerns, dependency management, and scalability.
```

## Best Practices

1. **Be patient** - Codex reviews take 5-10 minutes for thorough analysis
2. **Use todo lists** - Track each finding as a separate task
3. **Fix all bugs first** - Address actual bugs before considering design suggestions
4. **Verify with re-review** - Always run Codex again after making fixes
5. **Document decisions** - Note why design suggestions were accepted or declined
6. **Scope appropriately** - Focus reviews on specific areas when possible for faster iteration
7. **Stay autonomous** - Do NOT engage the user until the review cycle is complete and clean. Presenting summaries or asking "what should we do next?" before getting a clean review wastes user time.
8. **Enforce Project Standards** - Ensure review prompts explicitly ask to check for:
    - **Zero Hardcoded:** Flag any hardcoded URLs, Project IDs, or config.
    - **Fail-Closed Security:** Ensure error handling is explicit and secure.
    - **MSP Context:** Validate that multi-tenant isolation (`tenantId`) is respected.

## Interpreting Results

### Bugs (Fix These)
- Wrong file paths or imports
- Logic errors (e.g., array index misalignment)
- Missing error handling that causes crashes
- Security vulnerabilities

### Design Suggestions (Consider These)
- Portability concerns for internal tools
- Alternative approaches that are equally valid
- Intentional design decisions (e.g., empty content not getting vectors)

## Avoiding Bias in Review Prompts

DO:
- Let Codex discover what changed via git status/diff
- Ask open-ended questions ("What issues do you see?")
- Request it form its own conclusions

DON'T:
- List specific files to focus on
- Describe what you changed or why
- Ask leading questions ("Verify X is correct")
- Suggest expected conclusions
- Tell it what you were trying to fix

The point of an independent review is lost if you lead the witness.

## Owning the Decision

**Claude owns the code. Codex provides input, but the final decision is Claude's.**

Before accepting or rejecting any finding:

1. **Understand the architecture** - Read `/docs` and `CLAUDE.md` to understand design decisions
2. **Know the requirements** - Some patterns that look wrong may be intentional
3. **Evaluate against context** - A generic security scanner doesn't know your infrastructure
4. **Make the call** - Decide if the finding is a bug, a known limitation, or by design

### Example: False Positive

Codex flagged `authLevel: 'anonymous'` as a security risk. But CLAUDE.md §6 documents that Azure App Service Auth validates JWTs at infrastructure level before the function runs. The finding was a false positive because Codex didn't know about that architecture.

### Categories of Findings

| Finding Type | Action |
|--------------|--------|
| **Actual bug** | Fix it |
| **Known limitation** | Already documented in code comments - acknowledge and move on |
| **By design** | Explain why it's intentional, don't change it |
| **Good suggestion** | Consider for future improvement |
| **False positive** | Dismiss with explanation |

The value of Codex is the second opinion, but Claude must apply judgment based on actual project knowledge.

## Troubleshooting

### "stdout is not a terminal"
Use `codex exec` instead of just `codex`.

### Process seems stuck
Codex reviews are thorough. Wait the full 5-10 minutes before considering intervention.

### No findings returned
Check that there are actually uncommitted changes (`git status`).

### Codex can't find files
Ensure you're running from the correct working directory.

## Example Session

```
1. User: "Review my changes"
2. Claude: Runs `codex exec -s read-only "Review uncommitted changes..." 2>/dev/null` in background
3. Claude: Monitors with BashOutput until complete
4. Codex: Reports 4 issues with file:line references
5. Claude: Creates todo list with 4 items (does NOT report to user yet)
6. Claude: Fixes each issue, marking todos complete
7. Claude: Runs Codex review again (round 2)
8. Codex: Reports 2 new issues found
9. Claude: Fixes issues (does NOT report to user yet - still iterating)
10. Claude: Runs Codex review again (round 3)
11. Codex: Reports 1 new issue
12. Claude: Fixes issue
13. Claude: Runs Codex review again (round 4)
14. Codex: Reports no new bugs (only design suggestions)
15. Claude: NOW reports success to user with summary
```

**Key point:** Steps 4-14 happen autonomously without user interaction. Claude only reports at step 15 when the review is clean. This prevents wasting user time on premature discussions.

## Integration with Claude Workflow

This collaboration works best when:
- User requests a code review or asks Claude to fix issues
- Claude needs a "second opinion" on complex changes
- Validating that fixes are complete before committing
- Catching bugs that might be missed in manual review

The autonomous cycle (write → review → fix → verify) can run without user intervention, making it ideal for thorough code quality assurance.
