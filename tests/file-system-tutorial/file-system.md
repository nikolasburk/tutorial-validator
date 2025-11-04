# Terminal Basics Tutorial

Welcome to this hands-on tutorial about using the terminal! You'll learn essential commands by creating a simple project structure.

## Prerequisites

- A terminal application (Terminal on macOS/Linux, PowerShell or WST on Windows)
- Basic ability to open and use a terminal

## Getting Started

### Step 1: Create a New Directory for This Tutorial

Create a new directory called `terminal-tutorial`:
```bash
mkdir terminal-tutorial
```

**Validation:** List the contents of your current directory to verify the folder was created:
```bash
ls
```

**Expected output:** You should see `terminal-tutorial` in the list of files and directories. The exact output will vary based on what else is in your home directory, but `terminal-tutorial` must appear in the list.

### Step 2: Navigate Into the New Directory

Change into the `terminal-tutorial` directory:
```bash
cd terminal-tutorial
```

**Validation:** Verify you're now inside the `terminal-tutorial` directory:
```bash
pwd
```

**Expected output:** The output should end with `/terminal-tutorial`. The full path will look like:
- macOS/Linux: `/Users/yourusername/terminal-tutorial` or `/home/yourusername/terminal-tutorial`
- Windows: `C:\Users\yourusername\terminal-tutorial`

### Step 3: Verify the Directory is Empty

List the contents of the current directory:
```bash
ls
```

**Expected output:** Nothing should be displayed (empty output), or you might see a message indicating the directory is empty. This confirms you're starting with a clean directory.

### Step 4: Create a New File

Create a new empty file called `notes.txt`:
```bash
touch notes.txt
```

**Note:** The `touch` command creates an empty file if it doesn't exist. You won't see any output from this command.

**Validation:** List the files in the current directory:
```bash
ls
```

**Expected output:** You should see exactly one file:
```
notes.txt
```

### Step 5: Write Content to the File

Add some text to the `notes.txt` file using the `echo` command:
```bash
echo "Hello, Terminal!" > notes.txt
```

**Note:** The `>` operator writes the text to the file, replacing any existing content.

**Validation:** Display the contents of the file:
```bash
cat notes.txt
```

**Expected output:** You should see exactly:
```
Hello, Terminal!
```

### Step 6: Append More Content to the File

Add a second line to the file without overwriting the first line:
```bash
echo "This is my first tutorial." >> notes.txt
```

**Note:** The `>>` operator appends text to the file instead of replacing it.

**Validation:** Display the contents of the file again:
```bash
cat notes.txt
```

**Expected output:** You should see exactly:
```
Hello, Terminal!
This is my first tutorial.
```

### Step 7: Create Multiple Files

Create three more files at once:
```bash
touch file1.txt file2.txt file3.txt
```

**Validation:** List all files in the current directory:
```bash
ls
```

**Expected output:** You should see exactly four files (the order may vary):
```
file1.txt
file2.txt
file3.txt
notes.txt
```

### Step 8: Create a Subdirectory

Create a new directory called `docs`:
```bash
mkdir docs
```

**Validation:** List the contents to verify the directory was created:
```bash
ls
```

**Expected output:** You should see the three files and one directory (directories may be indicated differently depending on your system):
```
docs
file1.txt
file2.txt
file3.txt
notes.txt
```

### Step 9: Navigate Into the Subdirectory

Change into the `docs` directory:
```bash
cd docs
```

**Validation:** Verify your current location:
```bash
pwd
```

**Expected output:** The path should end with `/terminal-tutorial/docs`:
- macOS/Linux: `/Users/yourusername/terminal-tutorial/docs` or `/home/yourusername/terminal-tutorial/docs`
- Windows: `C:\Users\yourusername\terminal-tutorial\docs`

### Step 10: Create a File in the Subdirectory

Create a file called `readme.txt` in the current directory:
```bash
touch readme.txt
```

**Validation:** List the contents of the `docs` directory:
```bash
ls
```

**Expected output:** You should see exactly one file:
```
readme.txt
```

### Step 11: Navigate Back to the Parent Directory

Go back up one level to the `terminal-tutorial` directory:
```bash
cd ..
```

**Note:** `..` is a special notation that means "parent directory" (one level up).

**Validation:** Verify you're back in the `terminal-tutorial` directory:
```bash
pwd
```

**Expected output:** The path should end with `/terminal-tutorial`:
- macOS/Linux: `/Users/yourusername/terminal-tutorial` or `/home/yourusername/terminal-tutorial`
- Windows: `C:\Users\yourusername\terminal-tutorial`

**Additional validation:** List the contents to confirm you see both files and the `docs` directory:
```bash
ls
```

**Expected output:** You should see:
```
docs
file1.txt
file2.txt
file3.txt
notes.txt
```

## Congratulations!

You've completed the tutorial! You've learned how to:
- Navigate directories with `cd`
- Check your current location with `pwd`
- Create directories with `mkdir`
- Create files with `touch`
- List directory contents with `ls`
- Write to files with `echo` and `>` or `>>`
- View file contents with `cat`

### Optional: Clean Up

If you want to remove the tutorial directory and all its contents:
```bash
cd ~
rm -rf terminal-tutorial
```

**Warning:** Be careful with `rm -rf` as it permanently deletes files and directories without confirmation!RetryClaude can make mistakes. Please double-check responses.