# 🚀 Step-by-Step Guide: How to Upload Code to GitHub Using Terminal

Follow these simple, step-by-step instructions to upload your project code to GitHub using the terminal.

---

## 🔒 Crucial Security Step: Do Not Upload `.env` Files
Before staging or committing any files, ensure that your sensitive credentials are not tracked by Git.

1. Create or open the `.gitignore` file in your root folder.
2. Add the following lines to it to block your local environment files and dependencies:
   ```text
   node_modules/
   dist/
   .env*
   !.env.example
   .vercel/
   ```

---

## 📁 Step 1: Initialize Git (If Not Done Yet)
If you haven't initialized Git in your project directory:
```bash
git init
```

---

## 🔍 Step 2: Check the Status
Verify which files are modified, untracked, or ignored:
```bash
git status
```
> ⚠️ **Check carefully:** Ensure that `.env` or other files with sensitive keys are **not** listed under "Untracked files" or "Changes to be committed".

---

## ➕ Step 3: Stage Your Changes
To prepare all safe files for committing:
```bash
git add .
```
*(This will stage all files in your directory except those listed in `.gitignore`).*

---

## 💾 Step 4: Commit Your Changes
Create a snapshot of the staged changes with a meaningful commit message:
```bash
git commit -m "feat: commit message describing changes"
```

---

## 🔗 Step 5: Link Local Repo to GitHub (First Time Only)
If you haven't linked your local repository to a remote repository on GitHub:

1. Copy your repository's URL from GitHub (e.g., `https://github.com/username/repository.git`).
2. Run the command:
   ```bash
   git remote add origin https://github.com/username/repository.git
   ```
3. Set your main branch name to `main`:
   ```bash
   git branch -M main
   ```

---

## 🔄 Step 6: Handle Divergent Remote History (If Needed)
If you created files directly on GitHub (like a `README.md` or a `LICENSE` file), or if someone else pushed commits, you must pull them first:
```bash
git pull origin main --allow-unrelated-histories
```
> If a merge conflict occurs (e.g., in `README.md`), resolve it by opening the file in your code editor, deciding which code to keep, staging it (`git add README.md`), and finalizing the merge:
> ```bash
> git commit -m "merge: resolve merge conflicts"
> ```

---

## 🚀 Step 7: Push the Code to GitHub
Push your local commits to the remote repository on GitHub:
```bash
git push -u origin main
```
*(Subsequent pushes only require running `git push`).*

---

## 🛠 Useful Commands Cheat Sheet

| Command | What it does |
| :--- | :--- |
| `git status` | Shows modified, staged, and untracked files |
| `git diff` | Shows exact line changes not yet staged |
| `git log --oneline` | Displays a compact history of past commits |
| `git remote -v` | Lists all configured remote repository URLs |
| `git restore <file>` | Discards local unsaved changes in a file |
