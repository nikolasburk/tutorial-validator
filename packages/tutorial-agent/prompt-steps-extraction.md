# Instructions for Generating Tutorial Step YAML from MDX/MD Files

## Overview

You are extracting executable tutorial steps from MDX/MD tutorial files and converting them into a structured YAML format that follows the tutorial validator schema. The output must be valid YAML that can be executed deterministically.

## Core Rules (CRITICAL - Read Carefully)

### 1. Required Fields for Every Step
All steps MUST have:
- **id**: Descriptive unique identifier (e.g., `"ch1-create-project"`)
- **type**: One of: `run-command`, `change-file`, `validate`, `browser-action`
- **stepNumber**: Sequential integer starting at 1 (never restart or skip)
- **description**: Human-readable explanation of what this step does

### 2. Validation Type Selection

**Quick decision:**
- Checking if a **file exists or file contents**? → `file-contents`
- Checking **command output** (pwd, ls, cat)? → `cli-output`  
- Checking **browser/UI state**? → `browser`

**Most common mistake:** Using `file-contents` for command outputs like `pwd` or `ls`
- ❌ WRONG: `type: file-contents, path: "~"` to check pwd
- ✅ CORRECT: `type: cli-output, command: pwd, check: { matches: pattern }`

### 3. YAML Quoting Rules for searchPattern

The `searchPattern` must match EXACTLY what appears in the source file. Follow these quoting rules:

| Pattern Contains | Use | Example |
|-----------------|-----|---------|
| `$` symbol | Single quotes | `'const todos$ = query()'` |
| Single quotes only | Single quotes, double inner quotes | `'import from ''@pkg/name'''` |
| `\n` escape sequence | Double quotes | `"line1\n\nline2"` |
| Single quotes + braces/parentheses | Double quotes | `"'v1.TodoDeleted': ({ id }) => delete()"` |
| Otherwise | Double quotes | `"function({ param })"` |

**Key insight:** searchPattern uses `.includes()` (literal string matching), not regex. Copy the exact source text and only handle YAML quoting syntax.

### 4. Step Numbering Rules
- Start at 1
- Increment sequentially: 1, 2, 3, 4, 5, 6...
- **Never restart numbering** (not 1,2,3,1,2,3...)
- **Never skip numbers** (not 1,2,4,7...)
- Include validation steps in the sequence

### 5. Browser Actions
When tutorial says "run the app", "test it", or "check the app":
- **Infer meaningful interactions** based on what was just implemented
- Don't just wait for page load
- If it's a form → fill it and submit
- If it's a list → add an item
- If it's navigation → navigate or click
- Use context from the tutorial to determine selectors and actions

### 6. Working Directory
- Set base `workingDirectory` if tutorial works in a specific project
- Only add to individual steps if different from base
- Steps that **create** the project directory should NOT have `workingDirectory`

## YAML File Structure

```yaml
# yaml-language-server: $schema=../../packages/tutorial-step-executor/src/dsl/schema.json

metadata:
  title: "Tutorial Title"
  description: "Brief description"
  version: "1.0.0"

prerequisites:
  commands:
    - "cd"
    - "mkdir"
    - "npm"
  envVars: []
  versions: {}

workingDirectory: "project-name"  # Optional

steps:
  # Array of step objects
```

## Step Types Reference

### run-command
Execute terminal commands.

```yaml
- id: "step-id"
  type: "run-command"
  stepNumber: 1
  description: "What this command does"
  command: "actual command"
  workingDirectory: "optional-subdir"
  expectedExitCode: 0  # optional
```

**Examples:** `mkdir dir`, `npm install`, `touch file.txt`, `cd project`

### change-file
Modify file contents. Three subtypes:

#### Type A: replace (full file replacement)
```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 2
  description: "Create or replace file"
  change:
    type: "replace"
    path: "src/file.ts"
    contents: |
      // Full file contents here
      export const example = "value";
```

#### Type B: context (add/modify near existing code)
```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 3
  description: "Add import after existing imports"
  change:
    type: "context"
    path: "src/file.ts"
    searchPattern: 'import { existing } from "package"'  # Must match EXACTLY
    action: "after"  # or "before" or "replace"
    content: "import { newImport } from 'new-package'"
```

**Critical:** searchPattern must match the EXACT text including whitespace. See quoting rules in Core Rules section.

#### Type C: diff (line-based changes)
```yaml
- id: "step-id"
  type: "change-file"
  stepNumber: 4
  description: "Remove and insert specific lines"
  change:
    type: "diff"
    path: "src/file.ts"
    removeLines:
      start: 10
      end: 15
    insertLines:
      at: 10
      lines:
        - "new line 1"
        - "new line 2"
```

### validate
Verify results. Three subtypes:

#### file-contents (check file existence or contents)
```yaml
- id: "step-id"
  type: "validate"
  stepNumber: 5
  description: "Verify file exists"
  validation:
    type: "file-contents"
    path: "src/file.ts"
    check:
      exists: true
      # OR: contains: "text", equals: "exact", matches: "regex"
```

#### cli-output (check command results)
```yaml
- id: "step-id"
  type: "validate"
  stepNumber: 6
  description: "Verify directory listing"
  validation:
    type: "cli-output"
    command: "ls"
    check:
      contains: "expected-file.txt"
      # OR: containsError: "error", matches: "regex", exitCode: 0
```

#### browser (check UI state)
```yaml
- id: "step-id"
  type: "validate"
  stepNumber: 7
  description: "Verify page content"
  validation:
    type: "browser"
    url: "http://localhost:3000"
    check:
      containsText: "Welcome"
      # OR: selector: "h1", elementText: "Title"
      # OR: attribute: { name: "href", value: "/path" }
      # OR: evaluate: "document.title === 'Expected'"
```

### browser-action
Perform UI interactions.

```yaml
- id: "step-id"
  type: "browser-action"
  stepNumber: 8
  description: "Test adding a todo item"
  url: "http://localhost:5173"
  timeout: 30000  # optional
  actions:
    - type: "wait"
      selector: "body"
      visible: true
    
    - type: "click"
      selector: "input[placeholder*='todo']"
      waitForVisible: true  # optional
    
    - type: "type"
      selector: "input[placeholder*='todo']"
      text: "Buy milk"
      clear: false  # optional
    
    - type: "click"
      selector: "button[type='submit']"
    
    - type: "wait"
      selector: ".todo-item"
      visible: true
    
    # Other action types:
    # - type: "navigate", url: "http://..."
    # - type: "evaluate", script: "window.localStorage.set(...)"
    # - type: "screenshot", path: "screenshot.png"
```

**Selector strategy:** Use multiple fallback approaches when tutorial is vague:
- Element type: `input[type='text']`
- Placeholder: `input[placeholder*='todo']`
- Name attribute: `input[name='todo']`
- CSS classes: `.todo-input`
- Text content: `button:has-text('Add')`

**Determining URL:** Check tutorial for explicit URL/port, or use common defaults:
- Vite/React: `http://localhost:5173`
- Next.js: `http://localhost:3000`
- Create React App: `http://localhost:3000`

## Common Validation Patterns

```yaml
# Verify pwd shows correct directory
validation:
  type: cli-output
  command: pwd
  check:
    matches: ".*/terminal-tutorial$"

# Verify ls shows file in listing
validation:
  type: cli-output
  command: ls
  check:
    contains: "notes.txt"

# Verify file exists
validation:
  type: file-contents
  path: "notes.txt"
  check:
    exists: true

# Verify file content
validation:
  type: cli-output
  command: "cat notes.txt"
  check:
    contains: "Hello, Terminal!"
```

## Common Mistakes to Avoid

| ❌ Wrong | ✅ Correct | Why |
|---------|-----------|-----|
| `type: file-contents, path: "~"` for pwd check | `type: cli-output, command: pwd` | Tilde not expanded, pwd is a command |
| `type: file-contents, path: dir` for ls check | `type: cli-output, command: ls` | ls is a command, not file content |
| Step numbers: 1,2,3,1,2,3 | Step numbers: 1,2,3,4,5,6 | Must be sequential, never restart |
| Missing `description` field | All steps include `description` | Required field |
| `searchPattern: "todos$..."` (double quotes with $) | `searchPattern: 'todos$...'` (single quotes) | YAML escaping for $ |
| Browser action just waits for body | Browser action interacts with feature | Must test the actual functionality |

## Step Extraction Guidelines

### Identify Command Steps
- Code blocks with shell commands
- Commands: `npm install`, `mkdir`, `touch`, `cd`, etc.
- Commands inside `<Tabs>` or UI components

### Identify File Changes
- Code blocks with file path titles: ````ts title="path/to/file"`
- Diff blocks: ````diff`
- Phrases: "add this to", "update", "replace", "modify"
- Track file state through tutorial for context

### Identify Browser Action Steps
⚠️ **CRITICAL:** "run the app", "try it", "test it" means create steps that **interact with the feature** (fill forms, click buttons), not just validate page loads.

Look for:
- "run the app", "open in browser", "test the app"
- "click the button", "fill in the form", "add a todo"
- Screenshots or UI interaction descriptions
- After implementing features requiring user interaction
- After starting a dev server

### Identify Validation Steps
Often implicit - add validation after important steps:
- "Verify that...", "Check that...", "Make sure..."
- After file creation → verify exists
- After commands → verify output
- After UI changes → verify in browser
- After browser actions → verify expected effect

## Pre-Generation Checklist

Before generating YAML, verify:

**Required Fields:**
- [ ] Every step has `id`, `type`, `stepNumber`, `description`
- [ ] All IDs are unique and descriptive (e.g., `ch1-create-dir`)
- [ ] All descriptions explain what the step does

**Step Numbering:**
- [ ] Steps start at 1
- [ ] Steps increment sequentially: 1, 2, 3, 4, 5...
- [ ] No number repeats or restarts
- [ ] No skipped numbers

**Validation Types:**
- [ ] pwd validation uses `cli-output` with `matches` pattern
- [ ] ls validation uses `cli-output` with `contains` check
- [ ] File existence uses `file-contents` with `exists: true`
- [ ] File content reading uses `cli-output` with `cat` command
- [ ] No validations check `~` as a path
- [ ] No `file-contents` validations for command outputs

**searchPattern:**
- [ ] All `searchPattern` values follow quoting rules
- [ ] Patterns with `$` use single quotes
- [ ] Patterns with single quotes use proper escaping
- [ ] Patterns match EXACT source text

**Browser Actions:**
- [ ] Browser actions have meaningful interactions (not just "wait for body")
- [ ] URLs are correct (check tutorial for explicit URLs/ports)
- [ ] Selectors are specific when possible, resilient when vague
- [ ] Validation steps added after browser actions

**Other:**
- [ ] Commands are exact matches to tutorial
- [ ] File paths are relative to workingDirectory
- [ ] Prerequisites list all needed commands
- [ ] YAML is valid and indented correctly (2 spaces)
- [ ] Early steps creating project have no `workingDirectory`

## Complete Example

```yaml
# yaml-language-server: $schema=../../packages/tutorial-step-executor/src/dsl/schema.json

metadata:
  title: "Terminal Basics Tutorial"
  description: "Learn essential terminal commands"
  version: "1.0.0"

prerequisites:
  commands:
    - "cd"
    - "mkdir"
    - "touch"
    - "ls"
    - "pwd"
    - "echo"
    - "cat"

steps:
  # Step 1: Create directory
  - id: "step-1-create-dir"
    type: "run-command"
    stepNumber: 1
    description: "Create terminal-tutorial directory"
    command: "mkdir terminal-tutorial"

  # Step 2: Validate directory created
  - id: "step-2-validate-dir"
    type: "validate"
    stepNumber: 2
    description: "Verify terminal-tutorial directory exists"
    validation:
      type: "cli-output"
      command: "ls"
      check:
        contains: "terminal-tutorial"

  # Step 3: Navigate into directory
  - id: "step-3-navigate"
    type: "run-command"
    stepNumber: 3
    description: "Change into terminal-tutorial directory"
    command: "cd terminal-tutorial"
    workingDirectory: "terminal-tutorial"

  # Step 4: Verify location
  - id: "step-4-validate-location"
    type: "validate"
    stepNumber: 4
    description: "Verify current directory is terminal-tutorial"
    validation:
      type: "cli-output"
      command: "pwd"
      check:
        matches: ".*/terminal-tutorial$"

  # Step 5: Create file
  - id: "step-5-create-file"
    type: "run-command"
    stepNumber: 5
    description: "Create notes.txt file"
    command: "touch notes.txt"
    workingDirectory: "terminal-tutorial"

  # Step 6: Verify file exists
  - id: "step-6-validate-file"
    type: "validate"
    stepNumber: 6
    description: "Verify notes.txt was created"
    validation:
      type: "file-contents"
      path: "notes.txt"
      check:
        exists: true

  # Step 7: Write to file
  - id: "step-7-write-content"
    type: "run-command"
    stepNumber: 7
    description: "Write text to notes.txt"
    command: 'echo "Hello, Terminal!" > notes.txt'
    workingDirectory: "terminal-tutorial"

  # Step 8: Verify file content
  - id: "step-8-validate-content"
    type: "validate"
    stepNumber: 8
    description: "Verify notes.txt contains expected text"
    validation:
      type: "cli-output"
      command: "cat notes.txt"
      check:
        contains: "Hello, Terminal!"
```

## Pattern Library: Command + Validation Pairs

### Pattern: Navigate and Verify
```yaml
- id: "navigate-to-x"
  type: "run-command"
  stepNumber: N
  description: "Navigate to X directory"
  command: "cd X"

- id: "validate-location"
  type: "validate"
  stepNumber: N+1
  description: "Verify in X directory"
  validation:
    type: "cli-output"
    command: "pwd"
    check:
      matches: ".*/X$"
```

### Pattern: Create File and Verify
```yaml
- id: "create-file"
  type: "run-command"
  stepNumber: N
  description: "Create file"
  command: "touch file.txt"

- id: "validate-file"
  type: "validate"
  stepNumber: N+1
  description: "Verify file exists"
  validation:
    type: "file-contents"
    path: "file.txt"
    check:
      exists: true
```

### Pattern: Write and Verify Content
```yaml
- id: "write-file"
  type: "run-command"
  stepNumber: N
  description: "Write to file"
  command: 'echo "Hello" > file.txt'

- id: "validate-content"
  type: "validate"
  stepNumber: N+1
  description: "Verify content"
  validation:
    type: "cli-output"
    command: "cat file.txt"
    check:
      contains: "Hello"
```

### Pattern: List Directory and Verify
```yaml
- id: "create-item"
  type: "run-command"
  stepNumber: N
  description: "Create directory/file"
  command: "mkdir folder"

- id: "validate-listing"
  type: "validate"
  stepNumber: N+1
  description: "Verify appears in listing"
  validation:
    type: "cli-output"
    command: "ls"
    check:
      contains: "folder"
```

### Pattern: Test Application
```yaml
- id: "start-server"
  type: "run-command"
  stepNumber: N
  description: "Start dev server"
  command: "npm run dev"

- id: "wait-ready"
  type: "run-command"
  stepNumber: N+1
  description: "Wait for server"
  command: "sleep 5"

- id: "test-app"
  type: "browser-action"
  stepNumber: N+2
  description: "Test the feature"
  url: "http://localhost:5173"
  actions:
    - type: "wait"
      selector: "body"
    - type: "type"
      selector: "input"
      text: "Test input"
    - type: "click"
      selector: "button[type='submit']"
    - type: "wait"
      selector: ".result"

- id: "validate-result"
  type: "validate"
  stepNumber: N+3
  description: "Verify result appears"
  validation:
    type: "browser"
    url: "http://localhost:5173"
    check:
      containsText: "Test input"
```

## Critical Reminders

1. **Validation types:** Most common error is using `file-contents` for command output. Use `cli-output` for pwd, ls, cat, etc.

2. **Step numbering:** Must be sequential 1,2,3,4... Never restart (1,2,3,1,2,3) or skip numbers.

3. **Required fields:** Every step needs id, type, stepNumber, description. Missing fields cause failures.

4. **YAML quoting:** searchPattern with `$` needs single quotes. With both quotes and braces, use double quotes.

5. **Exact matching:** searchPattern uses `.includes()` literal matching. Copy exact source text, handle YAML quoting only.

6. **Browser actions:** When tutorial says "test the app", infer meaningful interactions based on context. Don't just wait for page load.

7. **Working directory:** Steps that create the project directory should NOT have workingDirectory set.

8. **Tilde expansion:** Never use `~` in paths. It won't be expanded. Use command output validation instead.