# Mirror a branch to Gitee

`sync-gitee.ps1` copies the committed tree of this repository to a second remote.
The copy lets a colleague read the code without access to the GitHub fork.

## What the script does

The script reads the tree of a source ref.
It removes the documentation recordings.
It writes a new commit with that tree.
Then it pushes the commit to the remote.

Each run makes a child of the previous run.
The branch on the remote is therefore a normal linear history, and the receiver can use `git pull`.

## What the script does not do

The script never reads the working tree and never runs `git add` against the real index.
Uncommitted changes cannot enter the remote.

The script builds the tree through a private index file inside the Git directory.
This design is necessary.
`git add -A` against the real index would stage your work.
`git checkout --orphan` would delete your untracked files when you switch back.

The script does not change your branch, your index, or your working tree.
It writes one local branch, `gitee-mirror` by default, and one remote branch.

## Requirements

- PowerShell 5.1 or later.
- `git` on PATH.
- A configured remote. See [First-time setup](#first-time-setup).

## First-time setup

Add the remote one time only:

```powershell
git remote add gitee https://gitee.com/<owner>/<repository>.git
```

Make sure that the repository grants write access to your account.
A private repository also needs the receiver as a member.

## Run a mirror

1. Make sure that the commit you want to share is the tip of your branch.
   The script mirrors committed content only, so commit your work first.
2. Run the script from the repository root:

   ```powershell
   .\docs\scripts\sync-gitee.ps1
   ```

3. Read the report.
   The report shows the file count, the size, and the number of removed recordings.
4. Type `yes` at the prompt.
   The script pushes the commit.

Use `-Yes` to skip the prompt in a script or a scheduled task.

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `-Remote` | `gitee` | Name of the receiving remote. |
| `-SourceRef` | `HEAD` | Ref whose committed tree is mirrored. |
| `-TargetBranch` | `main` | Branch on the remote that receives the mirror. |
| `-LocalBranch` | `gitee-mirror` | Local branch that records the mirror chain. |
| `-IncludeMedia` | off | Keep the documentation recordings. |
| `-Fresh` | off | Make a root commit instead of a child. |
| `-DryRun` | off | Build and report. Change nothing. |
| `-Yes` | off | Do not ask for confirmation. |
| `-Message` | generated | Commit message. |

## The documentation recordings

The `docs/` directory holds about 250 MB of screen recordings for the AIRI blog.
No part of the application reads them.
The script removes them to keep the mirror small.

The patterns are `docs/**/*.mp4`, `docs/**/*.MP4`, `docs/**/*.gif`, and `docs/**/*.avif`.
Files with these extensions outside `docs/` stay in the mirror.
The `apps/stage-tamagotchi` tutorial videos are an example.

Use `-IncludeMedia` when the receiver needs the recordings.
The push then transfers about 400 MB more.

## Receiver side

The receiver clones the repository one time:

```sh
git clone https://gitee.com/<owner>/<repository>.git
```

For later updates, the receiver pulls:

```sh
git pull
```

CAUTION: Do not use `-Fresh` after the receiver has cloned.
A root commit has no relation to the old history, so the receiver must reset:

```sh
git fetch && git reset --hard origin/main
```

## Troubleshooting

| Report | Cause | Action |
| --- | --- | --- |
| `The remote "gitee" does not exist.` | The remote is not configured. | Run the command in [First-time setup](#first-time-setup). |
| `The branch gitee-mirror already holds this tree.` | The remote already holds this content. | Nothing to do. Commit a change and run again. |
| `The mirror tree differs from the source tree by more than the documentation recordings.` | A filter removed a file outside `docs/`. | The script stopped before the push. Read the listed paths. |
| `stale info` during the push | The remote branch moved after the script read it. | Run the script again. It reads the new remote value. |
| The push stops with a size error | The remote has a repository size limit. | Use the default mode, which removes the recordings. |

## Why the tree differs from the source

The mirror is not a byte-for-byte copy of `HEAD`.
It is the tree of `HEAD` with the documentation recordings removed.
The script verifies this before the push.
Any other difference stops the run.

## Related files

| File | Purpose |
| --- | --- |
| `docs/scripts/sync-gitee.ps1` | The script. |
| `server/README.md` | The hosted backend. |
| `apps/stage-web/deploy/README.md` | Deployment of the web application. |
