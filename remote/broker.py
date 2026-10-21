#!/usr/bin/python3
"""Fixed root-owned broker. No caller-selected paths, images, mounts or Docker flags."""
import fcntl
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import subprocess
import sys
import time
import uuid

BASE = Path("/var/lib/tinfoil-workbench")
ROOT = BASE / "workspaces"
IMAGE = "tinfoil-workbench-tools:1"
IMAGES = {"dev": IMAGE, "kali": "tinfoil-workbench-kali:1"}
LABEL = "org.avrena.tinfoil-workbench"
MAX_WORKSPACES = 4
DISK_BYTES = 2 * 1024**3


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
        raise ValueError("Invalid workspace ID.")
    return value


def command(*args, timeout=60, check=True, **kw):
    return subprocess.run(args, timeout=timeout, check=check, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)


def container_output(argv, payload, timeout):
    """Bound output even if container code writes directly to PID 1's stdout."""
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output, errors = bytearray(), bytearray()
    deadline = time.monotonic() + timeout
    try:
        pending = memoryview(payload.encode("utf8"))
        os.set_blocking(process.stdin.fileno(), False)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdin, selectors.EVENT_WRITE, None)
            selector.register(process.stdout, selectors.EVENT_READ, output)
            selector.register(process.stderr, selectors.EVENT_READ, errors)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError("Container tool exceeded its timeout.")
                for key, _ in selector.select(min(remaining, 1)):
                    if key.fileobj is process.stdin:
                        try:
                            written = os.write(process.stdin.fileno(), pending[:16384])
                            pending = pending[written:]
                        except BrokenPipeError:
                            pending = pending[:0]
                        if not pending:
                            selector.unregister(process.stdin)
                            process.stdin.close()
                        continue
                    chunk = os.read(key.fileobj.fileno(), 16384)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    key.data.extend(chunk)
                    if len(output) > 500000 or len(errors) > 16000:
                        raise ValueError("Container tool output limit exceeded.")
        process.wait(timeout=max(1, deadline - time.monotonic()))
        return output.decode("utf8")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()


def write_json(path, value):
    # Job directories are writable by the worker account, so never write through
    # a name it could have planted: create a new temporary file without following
    # links, then rename it over the target (a rename replaces a link, not its target).
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w", encoding="utf8") as file:
        file.write(json.dumps(value, indent=2))
    os.replace(temp, path)


def workspace(value):
    ident = identifier(value)
    path = ROOT / ident
    if path.is_symlink() or not path.is_dir() or path.resolve().parent != ROOT.resolve():
        raise ValueError("Unknown workspace.")
    meta = json.loads((path / "meta.json").read_text())
    if meta.get("id") != ident or meta.get("managed") != LABEL:
        raise ValueError("Workspace ownership marker does not match.")
    return path, meta


def active_jobs(ident):
    jobs = []
    for file in (BASE / "jobs").glob("*/job.json"):
        data = json.loads(file.read_text())
        if data.get("workspace") == ident:
            unit = "tinfoil-job@" + identifier(data["id"]) + ".service"
            state = command("systemctl", "show", unit, "-p", "ActiveState", "--value").stdout.strip()
            if state in ("active", "activating", "deactivating", "reloading"):
                jobs.append(data["id"])
    return jobs


def mounted(path):
    target = path / "data"
    if target.is_symlink():
        raise ValueError("Unsafe workspace mountpoint.")
    result = command("findmnt", "-rn", "-M", str(target), "-o", "SOURCE", check=False)
    if result.returncode == 0:
        # Validate the loop backing file before trusting an existing mount.
        source = result.stdout.strip()
        backing = command("losetup", "--noheadings", "--output", "BACK-FILE", source).stdout.strip()
        if Path(backing).resolve() != (path / "disk.ext4").resolve():
            raise ValueError("Workspace mount has an unexpected backing file.")
        return True
    return False


def ensure_mount(path):
    if not mounted(path):
        if (path / "disk.ext4").is_symlink():
            raise ValueError("Unsafe workspace disk.")
        command("mount", "-o", "loop,nosuid,nodev", str(path / "disk.ext4"), str(path / "data"))


def network(ident):
    name = "tw-" + ident
    found = command("docker", "network", "inspect", name, check=False)
    if found.returncode == 0:
        data = json.loads(found.stdout)[0]
        if data.get("Labels", {}).get(LABEL) != ident:
            raise ValueError("Network ownership mismatch.")
    else:
        command("docker", "network", "create", "--label", LABEL + "=" + ident,
                "--opt", "com.docker.network.bridge.name=wb-" + ident[:10],
                "--opt", "com.docker.network.bridge.host_binding_ipv4=127.0.0.1", name)
    return name


def profile_image(profile):
    if not isinstance(profile, str) or profile not in IMAGES:
        raise ValueError("Tool profile must be dev or kali.")
    return IMAGES[profile]


def create(name=None, profile="dev"):
    image = profile_image(profile)
    if command("docker", "image", "inspect", image, check=False).returncode:
        raise ValueError("Tool profile image is not installed.")
    if name is not None and (not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name)):
        raise ValueError("Workspace name must be 1..80 characters on one line.")
    if len(list(ROOT.glob("*/meta.json"))) >= MAX_WORKSPACES:
        raise ValueError("Workspace limit reached (4); archive and delete an old workspace.")
    if shutil.disk_usage(BASE).free < DISK_BYTES + 2 * 1024**3:
        raise ValueError("Insufficient free disk space; preserve a 2 GiB host reserve.")
    ident = uuid.uuid4().hex
    path = ROOT / ident
    path.mkdir(mode=0o700)
    meta = {"id": ident, "managed": LABEL, "createdAt": time.time(), "lastUsed": time.time(), "quotaBytes": DISK_BYTES, "toolProfile": profile}
    if name is not None:
        meta["name"] = name.strip()
    write_json(path / "meta.json", meta)
    try:
        (path / "data").mkdir()
        # Reserve the entire quota now; sparse files could overcommit the host.
        command("fallocate", "-l", str(DISK_BYTES), str(path / "disk.ext4"))
        command("mkfs.ext4", "-q", "-E", "nodiscard", "-m", "0", str(path / "disk.ext4"))
        ensure_mount(path)
        # mkfs creates an empty root-only directory that generic workspace search
        # cannot traverse. No recovered files exist on this newly created disk.
        (path / "data" / "lost+found").rmdir()
        os.chown(path / "data", 1000, 1000)
        os.chmod(path / "data", 0o700)
        (path / "data" / ".home").mkdir()
        os.chown(path / "data" / ".home", 1000, 1000)
        network(ident)
        return meta
    except Exception:
        # Keep failed provisioning visible and recoverable; never silently erase it.
        meta["provisioningFailed"] = True
        write_json(path / "meta.json", meta)
        raise


def containers(ident):
    ids = command("docker", "ps", "-aq", "--filter", "label=" + LABEL + "=" + ident).stdout.split()
    return ids


def stop_tools(ident):
    for container in containers(ident):
        command("docker", "rm", "-f", container, check=False)


def cleanup_workspace(ident, archive=False):
    path, meta = workspace(ident)
    if active_jobs(ident):
        raise ValueError("Stop this workspace's active job before cleanup.")
    if containers(ident):
        raise ValueError("Workspace has active or leftover containers; stop tools first.")
    if archive:
        ensure_mount(path)
        destination = BASE / "archives" / (ident + "-" + str(time.time_ns()) + ".tar.gz")
        # tar archives symlinks as links; never dereference untrusted workspace links.
        command("tar", "--one-file-system", "-czf", str(destination), "-C", str(path / "data"), ".", timeout=300)
        os.chmod(destination, 0o600)
        return {"archive": str(destination), "bytes": destination.stat().st_size}
    if mounted(path):
        command("umount", str(path / "data"))
    name = "tw-" + ident
    found = command("docker", "network", "inspect", name, check=False)
    if found.returncode == 0:
        if json.loads(found.stdout)[0].get("Labels", {}).get(LABEL) != ident:
            raise ValueError("Network ownership mismatch.")
        command("docker", "network", "rm", name)
    # Only this root-owned directory, after checking that its mount is gone.
    if mounted(path):
        raise ValueError("Workspace is still mounted.")
    shutil.rmtree(path)
    return {"deleted": ident}


def tool(request):
    path, meta = workspace(request.get("id"))
    ident = meta["id"]
    # Only operator-owned workspace metadata selects an installed, fixed image.
    # Tool requests and model arguments cannot change profiles or Docker flags.
    image = profile_image(meta.get("toolProfile", "dev"))
    if request.get("name") not in {"list_files", "search_files", "read_file", "edit_file", "write_file", "run_command", "update_plan"}:
        raise ValueError("Unknown tool.")
    raw = request.get("arguments")
    if not isinstance(raw, str) or len(raw) > 300000:
        raise ValueError("Invalid tool arguments.")
    args = json.loads(raw)
    if not isinstance(args, dict):
        raise ValueError("Invalid tool arguments.")
    timeout = args.get("timeout_seconds", 120) if request["name"] == "run_command" else 30
    if type(timeout) is not int or not 1 <= timeout <= 600:
        raise ValueError("Invalid timeout.")
    with open(path / "tool.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        ensure_mount(path)
        net = network(ident)
        meta["lastUsed"] = time.time()
        write_json(path / "meta.json", meta)
        container = "tw-call-" + uuid.uuid4().hex
        argv = ["docker", "run", "--rm", "-i", "--name", container,
                "--label", LABEL + "=" + ident, "--network", net,
                "--user", "1000:1000", "--read-only", "--cap-drop=ALL",
                "--security-opt=no-new-privileges", "--memory=768m", "--memory-swap=768m",
                "--cpus=1", "--pids-limit=128", "--ulimit", "nofile=1024:1024",
                "--tmpfs", "/tmp:rw,nosuid,nodev,size=128m,mode=1777",
                "--mount", "type=bind,src=" + str(path / "data") + ",dst=/workspace",
                "--log-driver=none", image]
        try:
            # Output generated by the trusted wrapper is bounded. A malicious command
            # cannot write its own bytes onto this protocol stream.
            output = container_output(argv, json.dumps({"name": request["name"], "arguments": raw}), timeout + 20)
            parsed = json.loads(output)
            if not parsed.get("ok"):
                raise ValueError(parsed.get("error", "Container tool failed."))
            return parsed["result"]
        finally:
            command("docker", "rm", "-f", container, timeout=20, check=False)


def dispatch(request):
    op = request.get("op")
    # sudo is installed ONLY for this root-owned program. The worker never gets
    # lifecycle, image, network, arbitrary argv, or arbitrary mount operations.
    if os.environ.get("SUDO_USER") == "tinfoil-runner" and op != "tool":
        raise ValueError("Worker is permitted only container tools.")
    if op == "tool":
        return tool(request)
    if op == "create":
        return create(request.get("name"), request.get("profile", "dev"))
    if op == "list":
        return [dict(workspace(p.parent.name)[1], activeJobs=active_jobs(p.parent.name))
                for p in ROOT.glob("*/meta.json")]
    if op == "archive":
        return cleanup_workspace(request.get("id"), archive=True)
    if op == "delete":
        if request.get("confirm") != request.get("id"):
            raise ValueError("Deletion requires confirm equal to the exact workspace ID.")
        return cleanup_workspace(request.get("id"))
    if op == "stop-tools":
        ident = workspace(request.get("id"))[1]["id"]
        stop_tools(ident)
        return {"stopped": ident}
    if op == "cleanup":
        # Discovery only. No timer removes user files automatically.
        days = request.get("days", 7)
        if type(days) is not int or not 1 <= days <= 365:
            raise ValueError("days must be 1..365.")
        return [m for p in ROOT.glob("*/meta.json")
                if (m := workspace(p.parent.name)[1])["lastUsed"] < time.time() - days * 86400
                and not active_jobs(m["id"]) and not containers(m["id"])]
    raise ValueError("Unknown operation.")


def main():
    os.umask(0o077)
    raw = sys.stdin.buffer.read(400001)
    if len(raw) > 400000:
        raise ValueError("Request exceeds size limit.")
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise ValueError("Expected a JSON object.")
    # Lifecycle operations serialize globally; individual tools lock their workspace.
    if request.get("op") == "tool":
        result = dispatch(request)
    else:
        with open(BASE / "lifecycle.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = dispatch(request)
    print(json.dumps({"ok": True, "result": result}))


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "--stop-job" and not os.environ.get("SUDO_USER"):
            ident = identifier(sys.argv[2])
            job = json.loads((BASE / "jobs" / ident / "job.json").read_text())
            stop_tools(workspace(job["workspace"])[1]["id"])
        elif len(sys.argv) != 1:
            raise ValueError("Arguments are not accepted.")
        else:
            main()
    except Exception as error:
        # Do not include subprocess argv/output; those may contain private commands.
        message = str(error) if isinstance(error, (ValueError, BlockingIOError)) else type(error).__name__ + ": operation failed."
        print(json.dumps({"ok": False, "error": message[:2000]}))
        sys.exit(1)
