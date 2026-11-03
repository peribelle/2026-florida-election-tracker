#!/usr/bin/env python3
"""Publish the repo and the site after new data lands.

Every collector (refresh.sh, results.py, results_precinct_slow.py, projections.py) ends by asking for a
publish. One publish does, in order:

  1. rebuild Reports/viewer.html                 build_viewer.py, 180 s limit
  2. copy it to docs/index.html and render docs/preview.png from it (the image in the README)
  3. commit data/ raw/ Reports/ runs/ results/ projections/ docs/ and nothing else, so code is never swept in
  4. push main; GitHub Pages redeploys the site by itself

A pull can never wait on this or fail because of it. Collectors start it detached. It holds a lock, so asks
that arrive while it is busy collapse into one more publish. It waits until the files have stopped changing
before it commits, and spaces pushes PUBLISH_MIN_INTERVAL apart because GitHub Pages soft-limits builds to
10 an hour. Every step is time-limited and every outcome lands in logs/publish.log.

Pushes use github_known_hosts (GitHub's published host keys), so an unattended push never needs a prompt.

Usage:
  publish.py              publish now, in the foreground, without the waits (for hand use)
  publish.py --queue      ask for a publish and return at once (what refresh.sh calls)
  publish.py --status     last result, pending request, unpushed commits
  publish.py --worker     the detached loop the collectors start (internal)

Environment:
  NO_PUBLISH=1            collectors skip the request (testing)
  PUBLISH_MIN_INTERVAL    seconds between pushes (default 300)
  PUBLISH_QUIET           seconds the files must be still before a commit (default 15)
  PUBLISH_BROWSER         Chromium for the preview (default: PATH, then Playwright's cache)
"""
import argparse, fcntl, filecmp, glob, json, os, pathlib, re, shlex, shutil, signal, subprocess, sys, tempfile, time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(HERE, "logs")
LOG = os.path.join(LOGS, "publish.log")
LOCK = os.path.join(LOGS, ".publish.lock")
PENDING = os.path.join(LOGS, ".publish_pending")
STATE = os.path.join(LOGS, ".publish_state.json")
KNOWN_HOSTS = os.path.join(HERE, "github_known_hosts")
VIEWER = os.path.join(HERE, "Reports", "viewer.html")
PAGE = os.path.join(HERE, "docs", "index.html")
PREVIEW = os.path.join(HERE, "docs", "preview.png")

BRANCH = "main"
# Only these are ever committed: the pipeline's outputs and the site. Never code, so an edit in progress is never swept up.
PATHS = ["data", "raw", "Reports", "runs", "results", "projections", "docs"]
MIN_INTERVAL = int(os.environ.get("PUBLISH_MIN_INTERVAL", "300"))
QUIET = int(os.environ.get("PUBLISH_QUIET", "15"))
QUIET_MAX = 120          # stop waiting for quiet after this long and publish anyway
RETRIES = 4              # failed publishes in a row before the worker gives up (the next pull tries again)
RETRY_DELAY = int(os.environ.get("PUBLISH_RETRY_DELAY", "60"))
VIEW_W, VIEW_H, DPR = 1280, 1100, 1.5     # preview render size in CSS px and its sharpness

SNAP = re.compile(r"^(runs|results/slow|results|projections)/(\d{8}-\d{6})/")
KINDS = [("runs", "turnout"), ("results", "results"), ("results/slow", "precinct-slow"), ("projections", "projections")]


class Fail(Exception):
    pass


def log(msg):
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    try:
        os.makedirs(LOGS, exist_ok=True)
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if sys.stdout.isatty():
        print(line)


def tail(text, n=3):
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    return " | ".join(lines[-n:])[:300]


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(**kw):
    st = load_state()
    st.update(kw)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE)


def touch(path):
    with open(path, "a"):
        os.utime(path)


def run(cmd, timeout, env=None):
    """Run in its own session and kill the whole group on timeout, so a hung browser or ssh can't linger."""
    p = subprocess.Popen(cmd, cwd=HERE, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, err = p.communicate()
        return subprocess.CompletedProcess(cmd, 124, out, (err or "") + f"\ntimed out after {timeout}s")
    return subprocess.CompletedProcess(cmd, p.returncode, out, err)


def git(*args, timeout=120, push=False):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", LC_ALL="C")
    if push and os.path.exists(KNOWN_HOSTS):
        env["GIT_SSH_COMMAND"] = ("ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "
                                  f"-o UserKnownHostsFile={shlex.quote(KNOWN_HOSTS)} -o GlobalKnownHostsFile=/dev/null "
                                  "-o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4")
    return run(["git", *args], timeout, env)


# ---- asking for a publish (called by every collector) ------------------------------------------------------

def queue_publish():
    """Ask for a publish and return at once. Never raises and never blocks, so a pull can't be affected."""
    if os.environ.get("NO_PUBLISH", "") not in ("", "0"):
        return
    try:
        os.makedirs(LOGS, exist_ok=True)
        touch(PENDING)
        subprocess.Popen([sys.executable, os.path.abspath(__file__), "--worker"], cwd=HERE,
                         stdin=subprocess.DEVNULL, stdout=open(LOG, "a"), stderr=subprocess.STDOUT,
                         start_new_session=True)
    except Exception as e:
        print(f"  ! publish not queued: {str(e)[:80]}")


# ---- the site: viewer, docs/index.html, docs/preview.png ---------------------------------------------------

def build_viewer():
    """Rebuild the page unless it is already newer than everything it is built from (so a no-op publish is a no-op)."""
    inputs = [p for p in PATHS if p != "docs"] + ["viewer", "build_viewer.py"]
    if os.path.exists(VIEWER) and os.path.getmtime(VIEWER) >= newest_mtime(inputs, skip={VIEWER}):
        return True
    r = run([sys.executable, os.path.join(HERE, "build_viewer.py")], 180)
    if r.returncode != 0:
        log(f"viewer build failed (exit {r.returncode}); keeping the last page: {tail(r.stdout + r.stderr)}")
        return False
    return True


def find_browser():
    env = os.environ.get("PUBLISH_BROWSER")
    if env and os.access(env, os.X_OK):
        return env
    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        found = shutil.which(name)
        if found:
            return found
    cache = os.path.expanduser("~/.cache/ms-playwright")      # what this machine has: prefer the lean headless shell
    for pattern in ("chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
                    "chromium-*/chrome-linux64/chrome"):
        hits = sorted(glob.glob(os.path.join(cache, pattern)), key=lambda p: int(re.search(r"-(\d+)/", p).group(1)))
        if hits:
            return hits[-1]
    return None


def crop_to_stats(raw, out):
    """Keep the header, the hero card and the row of stat tiles; drop the rest. Returns True if the image changed."""
    from PIL import Image
    im = Image.open(raw).convert("RGB")
    k = im.width / VIEW_W
    px = im.load()
    xs = range(int(60 * k), int(1220 * k), 3)

    def card(y):        # share of the row that is card-white rather than page background
        return sum(1 for x in xs if px[x, y][0] >= 252 and px[x, y][1] >= 250) / len(xs)

    blocks, start = [], None
    for y in range(im.height):
        on = card(y) >= 0.25
        if on and start is None:
            start = y
        elif not on and start is not None:
            if y - start >= 40 * k:
                blocks.append((start, y))
            start = None
    # the hero card, then the tiles; if the layout ever changes, fall back to a fixed height
    cut = blocks[1][1] + 24 * k if len(blocks) >= 2 else 820 * k
    shot = im.crop((0, 0, im.width, int(min(max(cut, 700 * k), im.height))))
    if len(shot.resize((96, 64)).getcolors(96 * 64)) < 12:
        raise Fail("preview came out blank")
    img = shot.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    fd, tmp = tempfile.mkstemp(suffix=".png", dir=LOGS)
    os.close(fd)
    img.save(tmp, format="PNG", optimize=True)
    os.chmod(tmp, 0o644)
    if os.path.exists(out) and filecmp.cmp(tmp, out, shallow=False):
        os.unlink(tmp)
        return False
    os.replace(tmp, out)
    return True


def render_preview():
    browser = find_browser()
    if not browser:
        log("preview: no Chromium found (set PUBLISH_BROWSER); image not refreshed")
        return
    fd, raw = tempfile.mkstemp(suffix=".png", dir=LOGS)
    os.close(fd)
    try:
        with tempfile.TemporaryDirectory(dir=LOGS, ignore_cleanup_errors=True) as profile:
            cmd = [browser, "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={profile}",
                   f"--force-device-scale-factor={DPR}", f"--window-size={VIEW_W},{VIEW_H}",
                   "--virtual-time-budget=10000", f"--screenshot={raw}", pathlib.Path(PAGE).as_uri()]
            if "headless" not in os.path.basename(browser):
                cmd.insert(1, "--headless=new")
            r = run(cmd, 60)
        if os.path.getsize(raw) < 10_000:
            raise Fail(f"browser wrote no image: {tail(r.stderr)}")
        if crop_to_stats(raw, PREVIEW):
            log("preview: docs/preview.png refreshed")
    except Exception as e:
        log(f"preview failed, keeping the old image: {str(e)[:200]}")
    finally:
        if os.path.exists(raw):
            os.unlink(raw)


def sync_site():
    if not os.path.exists(VIEWER):
        log("no Reports/viewer.html; site left as it was")
        return
    os.makedirs(LOGS, exist_ok=True)
    os.makedirs(os.path.dirname(PAGE), exist_ok=True)
    touch(os.path.join(os.path.dirname(PAGE), ".nojekyll"))
    changed = not (os.path.exists(PAGE) and filecmp.cmp(VIEWER, PAGE, shallow=False))
    if changed:
        fd, tmp = tempfile.mkstemp(suffix=".html", dir=LOGS)
        os.close(fd)
        shutil.copyfile(VIEWER, tmp)
        os.chmod(tmp, 0o644)
        os.replace(tmp, PAGE)
    if changed or not os.path.exists(PREVIEW):
        render_preview()


# ---- the repo: commit and push -----------------------------------------------------------------------------

def unsafe():
    """Why we must not commit right now, or None."""
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch != BRANCH:
        return f"on branch '{branch}', not '{BRANCH}'"
    gitdir = git("rev-parse", "--git-dir").stdout.strip()
    for marker in ("rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"):
        if os.path.exists(os.path.join(HERE, gitdir, marker)):
            return f"a {marker} is in progress"
    return None


def commit():
    """Stage and commit the pipeline's paths. Returns (short sha, file count), or (None, 0) if nothing is new."""
    paths = [p for p in PATHS if os.path.isdir(os.path.join(HERE, p))]
    r = git("add", "-A", "--", *paths, timeout=300)
    if r.returncode:
        raise Fail("git add: " + tail(r.stderr))
    if git("diff", "--cached", "--quiet", "--", *paths).returncode == 0:
        return None, 0
    names = [n for n in git("diff", "--cached", "--name-only", "-z", "--", *paths).stdout.split("\0") if n]
    snaps = sorted({(m.group(1), m.group(2)) for n in names if (m := SNAP.match(n))})
    kinds = [label for prefix, label in KINDS if any(s[0] == prefix for s in snaps)]
    msg = f"Data update {datetime.now():%Y-%m-%d %H:%M} ({', '.join(kinds) if kinds else 'site only'})"
    if snaps:
        msg += "\n\n" + "\n".join(f"{p}/{i}" for p, i in snaps)
    msg += f"\n\n{len(names)} files changed"
    # path-limited, so anything someone else has staged elsewhere stays staged and out of this commit
    r = git("-c", "gc.auto=0", "commit", "-q", "-m", msg, "--", *paths, timeout=120)
    if r.returncode:
        raise Fail("git commit: " + tail(r.stderr or r.stdout))
    return git("rev-parse", "--short", "HEAD").stdout.strip(), len(names)


def unpushed():
    r = git("rev-list", "--count", f"origin/{BRANCH}..HEAD")
    return int(r.stdout) if r.returncode == 0 and r.stdout.strip().isdigit() else None


def push():
    if git("remote", "get-url", "origin").returncode:
        log("no 'origin' remote; committed locally only")
        return True
    r = git("push", "-q", "origin", BRANCH, timeout=300, push=True)
    if r.returncode == 0:
        save_state(last_push_epoch=time.time())
        return True
    hint = ""
    if "Host key verification failed" in r.stderr:
        hint = " (GitHub's host key changed? regenerate: gh api meta --jq '.ssh_keys[]' | sed 's/^/github.com /' > github_known_hosts)"
    elif "Permission denied" in r.stderr:
        hint = " (GitHub did not accept the ssh key)"
    elif "rejected" in r.stderr or "non-fast-forward" in r.stderr:
        hint = " (origin/main has commits this clone lacks: pull --rebase by hand)"
    raise Fail(f"git push: {tail(r.stderr, 4)}{hint}")


def cycle(settle):
    """One publish. Returns False only if it failed and is worth retrying."""
    why = unsafe()
    if why:
        log(f"skipped: {why}")
        return True
    t0 = time.time()
    try:
        build_viewer()
        sync_site()
        if settle:                          # a pull may have started while we were building; don't stage it half-written
            wait_for_quiet(skip={VIEWER})
        sha, files = commit()
        ahead = unpushed()
        if sha is None and ahead == 0:
            log("nothing new to publish")
            return True
        push()
    except Fail as e:
        log(f"FAILED: {e}")
        save_state(last_error=str(e), last_error_at=f"{datetime.now():%Y-%m-%d %H:%M:%S}")
        return False
    except Exception as e:
        log(f"FAILED: {type(e).__name__}: {str(e)[:200]}")
        save_state(last_error=f"{type(e).__name__}: {str(e)[:200]}", last_error_at=f"{datetime.now():%Y-%m-%d %H:%M:%S}")
        return False
    head = git("rev-parse", "--short", "HEAD").stdout.strip()
    took = time.time() - t0
    save_state(last_ok=f"{datetime.now():%Y-%m-%d %H:%M:%S}", last_commit=head, last_seconds=round(took), last_error="")
    log(f"published {head}" + (f" ({files} files)" if sha else " (earlier commits)") + f" in {took:.0f}s")
    return True


# ---- the worker: lock, wait, publish, repeat while asks keep arriving --------------------------------------

def newest_mtime(tops, skip=()):
    """Newest modification time under the given paths (directories or files), ignoring the files in skip."""
    newest = 0.0
    for top in tops:
        full = os.path.join(HERE, top)
        found = [(os.path.dirname(full), [os.path.basename(full)])] if os.path.isfile(full) else \
                [(root, files) for root, _, files in os.walk(full)]
        for root, files in found:
            for name in files:
                path = os.path.join(root, name)
                if path in skip:
                    continue
                try:
                    newest = max(newest, os.stat(path).st_mtime)
                except OSError:
                    pass
    return newest


def wait_for_quiet(skip=()):
    """A pull may still be writing (projections run beside results). Commit only once the files have settled."""
    deadline = time.time() + QUIET_MAX
    while True:
        age = time.time() - newest_mtime([p for p in PATHS if p != "docs"], skip)
        if age >= QUIET:
            return
        if time.time() >= deadline:
            log(f"files still changing after {QUIET_MAX}s; publishing anyway")
            return
        time.sleep(min(QUIET - age + 1, 5))


def wait_for_interval():
    wait = load_state().get("last_push_epoch", 0) + MIN_INTERVAL - time.time()
    if wait > 0:
        log(f"spacing pushes: waiting {wait:.0f}s")
        time.sleep(min(wait, MIN_INTERVAL))


def drain(now):
    failures = 0
    while os.path.exists(PENDING):
        if not now:
            wait_for_interval()
            wait_for_quiet()
        try:
            os.remove(PENDING)
        except FileNotFoundError:
            pass
        if cycle(settle=not now):
            failures = 0
            continue
        failures += 1
        if now or failures >= RETRIES:
            if not now:
                log(f"giving up after {failures} failed attempts; the next pull will try again")
                touch(PENDING)
            return False
        log(f"retrying in {RETRY_DELAY}s ({failures}/{RETRIES})")
        time.sleep(RETRY_DELAY)
        touch(PENDING)
    return True


def worker(now=False):
    os.makedirs(LOGS, exist_ok=True)
    lock = open(LOCK, "w")
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return None                      # another worker is running; it will see the request
        try:
            ok = drain(now)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
        # an ask that landed while we held the lock was left pending: take the lock again and serve it
        if not ok or not os.path.exists(PENDING):
            return ok


def status():
    st = load_state()
    busy = False
    try:
        with open(LOCK, "a+") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(f, fcntl.LOCK_UN)
            except BlockingIOError:
                busy = True
    except OSError:
        pass
    ahead = unpushed()
    print("publish status")
    print(f"  last ok     {st.get('last_ok', 'never')}" + (f"  (commit {st['last_commit']}, {st.get('last_seconds', '?')}s)" if st.get("last_commit") else ""))
    print(f"  last error  {st.get('last_error') or 'none'}" + (f"  at {st['last_error_at']}" if st.get("last_error") else ""))
    print(f"  request     {'pending' if os.path.exists(PENDING) else 'none'};  worker {'running' if busy else 'idle'}")
    print(f"  unpushed    {'unknown' if ahead is None else str(ahead) + ' commit(s)'}")
    if os.path.exists(LOG):
        print(f"  log         logs/publish.log, last lines:")
        with open(LOG) as f:
            for line in f.readlines()[-5:]:
                print("    " + line.rstrip())


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--queue", action="store_true", help="ask for a publish and return at once")
    ap.add_argument("--worker", action="store_true", help="the detached loop (internal)")
    ap.add_argument("--status", action="store_true", help="show the last result and any pending request")
    a = ap.parse_args()
    if a.status:
        status()
        return 0
    if a.queue:
        queue_publish()
        return 0
    if a.worker:
        try:
            os.nice(10)                      # never compete with a pull for the CPU
        except OSError:
            pass
        worker(now=False)
        return 0                             # a worker never reports failure to anyone; it is in the log
    os.makedirs(LOGS, exist_ok=True)
    touch(PENDING)
    ok = worker(now=True)
    if ok is None:
        print("another publish is running; it will pick up this request")
        return 0
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
