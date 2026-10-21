#!/usr/bin/python3
"""Human/operator control plane over existing key-authenticated SSH, JSON on stdin."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import sys
import time
import uuid
from broker import BASE, command, dispatch, identifier, workspace, active_jobs, write_json, ensure_mount
from display import transcript_view
from settings import job_settings, same_submission


def job_view(ident, details=False):
    ident = identifier(ident)
    path = BASE / "jobs" / ident
    job = json.loads((path / "job.json").read_text())
    state = json.loads((path / "state.json").read_text()) if (path / "state.json").is_file() else {"status": "starting"}
    service = command("systemctl", "show", "tinfoil-job@" + ident + ".service", "-p", "ActiveState", "--value").stdout.strip()
    if state["status"] in {"running", "starting", "authenticating"} and service not in {"active", "activating"}:
        state = dict(state, status="error" if state["status"] == "starting" else "interrupted", reason="startup" if state["status"] == "starting" else "shutdown", error="Worker exited or host restarted. Inspect retained results; nothing is automatically replayed.")
    result = {key: state[key] for key in ["status", "reason", "startedAt", "finishedAt", "rounds", "calls", "usage", "error", "verified"] if key in state}
    result.update(id=ident, workspace=job["workspace"], model=job["model"], createdAt=job["createdAt"], service=service,
                  prompt=job["prompt"][:16000 if details else 160])
    if not details:
        return result
    result["settings"] = job_settings(job)
    truncated = len(job["prompt"]) > 16000
    def clip(value, limit=16000):
        nonlocal truncated
        value = str(value or "")
        truncated |= len(value) > limit
        return value[:limit]
    result.update(content=clip(state.get("content"), 100000), reasoning=clip(state.get("reasoning"), 60000),
                  partial={key: clip(state.get("partial", {}).get(key), 60000) for key in ["content", "reasoning"]}, tools=[])
    for tool in state.get("tools", [])[-60:]:
        data = {key: clip(tool.get(key)) for key in ["id", "name", "arguments", "status", "error"]}
        raw = tool.get("result", {})
        data["result"] = {key: clip(raw[key], 8000) for key in ["text", "diff", "stdout", "stderr"] if key in raw}
        data["result"].update({key: raw[key] for key in ["exitCode", "timedOut"] if key in raw})
        result["tools"].append(data)
    transcript, shortened = transcript_view(state, state.get("tools", [])[-60:])
    if transcript is not None:
        result["transcript"] = transcript
    truncated |= shortened
    result["truncated"] = truncated
    return result


def run(request):
    op = request.get("op")
    if op == "overview":
        files = sorted((BASE / "jobs").glob("*/job.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        result = {"protocol": 1, "features": {"jobSettings": True}, "auth": run({"op": "auth-status"}), "workspaces": dispatch({"op": "list"}),
                  "jobs": [job_view(p.parent.name) for p in files[:200]], "jobsTruncated": len(files) > 200, "checkedAt": time.time()}
        if request.get("id"):
            target = identifier(request["id"])
            if (BASE / "jobs" / target / "job.json").is_file():
                result["detail"] = job_view(target, details=True)
        elif files:
            result["detail"] = job_view(files[0].parent.name, details=True)
        return result
    if op == "inspect":
        return job_view(request.get("id"), details=True)
    if op == "operator-tool":
        ident = workspace(request.get("id"))[1]["id"]
        if active_jobs(ident):
            raise ValueError("Stop the workspace's job before operator tools.")
        return dispatch(dict(request, op="tool"))
    if op == "set-model":
        model = request.get("model")
        if not isinstance(model, str) or not 1 <= len(model) <= 200 or any(ord(c) < 32 for c in model):
            raise ValueError("Supply an exact model ID.")
        write_json(Path("/etc/tinfoil-workbench/config.json"), {"model": model})
        return {"defaultModel": model}
    if op in {"create", "list", "archive", "delete", "cleanup", "stop-tools", "tool"}:
        return dispatch(request)
    if op in {"configure-chat", "disconnect-chat"}:
        if any(active_jobs(p.parent.name) for p in (BASE / "workspaces").glob("*/meta.json")):
            raise ValueError("Stop the active job before changing the remote Chat account.")
        path = BASE / "auth" / "session.bin"
        if op == "disconnect-chat":
            path.unlink(missing_ok=True)
            return {"disconnected": True, "note": "Local remote-session copy removed. Revoke the dedicated session in Tinfoil for provider-side revocation."}
        result = command("/usr/local/lib/tinfoil-workbench-node",
                         "/usr/local/lib/tinfoil-workbench/remote/install-chat-session.mjs",
                         input=json.dumps(request.get("session")), check=False)
        if result.returncode != 0:
            raise ValueError("Chat session installation failed.")
        owner = pwd.getpwnam("tinfoil-runner")
        os.chown(path, owner.pw_uid, owner.pw_gid, follow_symlinks=False)
        return {"connected": True, "connectionMode": "chat-account"}
    if op == "auth-status":
        return {"connectionMode": "chat-account", "enrolled": (BASE / "auth" / "session.bin").is_file(),
                "defaultModel": json.loads(Path("/etc/tinfoil-workbench/config.json").read_text()).get("model") if Path("/etc/tinfoil-workbench/config.json").is_file() else None,
                "note": "Enrollment does not prove the session is still valid; jobs check identity and subscription access."}
    if op == "submit":
        requested_id = identifier(request["requestId"]) if "requestId" in request else None
        if requested_id and (BASE / "jobs" / requested_id / "job.json").is_file():
            previous = json.loads((BASE / "jobs" / requested_id / "job.json").read_text())
            if not same_submission(previous, request):
                raise ValueError("Submission ID already belongs to another task.")
            return {"id": requested_id, "workspace": previous["workspace"], "status": "already-submitted"}
        workspace_path, meta = workspace(request.get("workspace"))
        ident = meta["id"]
        if request.get("policy") != "workspace-auto":
            raise ValueError("Unattended jobs require policy=workspace-auto.")
        if not (BASE / "auth" / "session.bin").is_file():
            raise ValueError("Connect a dedicated Tinfoil Chat subscription session first.")
        if active_jobs(ident):
            raise ValueError("This workspace already has a running job.")
        ensure_mount(workspace_path)
        count = sum(len(active_jobs(p.parent.name)) for p in (BASE / "workspaces").glob("*/meta.json"))
        if count >= 1:
            raise ValueError("One job at a time on this 2 GiB VPS; wait for or stop the active job.")
        model, prompt = request.get("model"), request.get("prompt")
        if model in {None, "default"}:
            config = Path("/etc/tinfoil-workbench/config.json")
            model = json.loads(config.read_text()).get("model") if config.is_file() else None
        if not isinstance(model, str) or not 1 <= len(model) <= 200 or any(ord(c) < 32 for c in model):
            raise ValueError("Supply the exact Tinfoil model ID.")
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 160000:
            raise ValueError("Prompt must be 1..160000 characters.")
        job = {"id": requested_id or uuid.uuid4().hex, "workspace": ident, "model": model, "prompt": prompt,
               "policy": "workspace-auto", "createdAt": time.time()}
        job.update(job_settings(request))
        path = BASE / "jobs" / job["id"]
        path.mkdir(mode=0o700)
        owner = pwd.getpwnam("tinfoil-runner")
        os.chown(path, owner.pw_uid, owner.pw_gid, follow_symlinks=False)
        write_json(path / "job.json", job)
        os.chown(path / "job.json", owner.pw_uid, owner.pw_gid, follow_symlinks=False)
        # systemd owns the process independently of SSH or Workbench.
        command("systemctl", "start", "tinfoil-job@" + job["id"] + ".service")
        return {"id": job["id"], "workspace": ident, "status": "started"}
    if op == "jobs":
        return [{"id": p.parent.name, "workspace": json.loads(p.read_text())["workspace"]}
                for p in (BASE / "jobs").glob("*/job.json")]
    if op in {"status", "result", "stop", "delete-job"}:
        ident = identifier(request.get("id"))
        path = BASE / "jobs" / ident
        job = json.loads((path / "job.json").read_text())
        unit = "tinfoil-job@" + ident + ".service"
        if op == "stop":
            write_json(path / "stop-request.json", {"reason": "operator", "requestedAt": time.time()})
            command("systemctl", "stop", unit)
            # ExecStopPost removes this job's containers. Do not stop a newer job
            # in the same workspace if it started just as this unit finished.
            return job_view(ident, details=True)
        unit_state = command("systemctl", "show", unit, "-p", "ActiveState", "--value").stdout.strip()
        if op == "delete-job":
            if unit_state in {"active", "activating", "deactivating"}:
                raise ValueError("Stop the job before deleting its records.")
            if request.get("confirm") != ident:
                raise ValueError("Deleting job records requires the exact job ID as confirm.")
            if path.is_symlink() or path.resolve().parent != (BASE / "jobs").resolve():
                raise ValueError("Unexpected job path.")
            import shutil
            shutil.rmtree(path)
            command("systemctl", "reset-failed", unit, check=False)
            return {"deletedJob": ident}
        state = json.loads((path / "state.json").read_text()) if (path / "state.json").is_file() else {"status": "starting"}
        if state["status"] in {"running", "starting", "authenticating"} and unit_state not in {"active", "activating"}:
            state["status"] = "interrupted"
            state["error"] = "Worker exited or host restarted. Inspect retained results; nothing is automatically replayed."
        if op == "result":
            return state
        return {key: value for key, value in dict(state, id=ident, service=unit_state).items()
                if key not in {"messages", "tools", "content", "reasoning", "partial"}}
    raise ValueError("Unknown operation.")


def respond(raw):
    try:
        if len(raw) > 400000:
            raise ValueError("Request too large.")
        request = json.loads(raw)
        if request.get("op") in {"status", "result", "inspect", "stop"}:
            result = run(request)
        else:
            with open(BASE / "lifecycle.lock", "w") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                result = run(request)
        print(json.dumps({"ok": True, "result": result}), flush=True)
        return True
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else type(error).__name__ + ": operation failed."
        print(json.dumps({"ok": False, "error": message[:2000]}), flush=True)
        return False


if __name__ == "__main__":
    os.umask(0o077)
    if os.geteuid() != 0 or os.environ.get("SUDO_USER") == "tinfoil-runner":
        print(json.dumps({"ok": False, "error": "Operator access required."}))
        sys.exit(1)
    if sys.argv[1:] == ["--serve"]:
        while raw := sys.stdin.buffer.readline(400001):
            respond(raw)
            if len(raw) > 400000:
                break
    elif sys.argv[1:]:
        print(json.dumps({"ok": False, "error": "Unknown controller option."}))
        sys.exit(1)
    else:
        sys.exit(0 if respond(sys.stdin.buffer.read(400001)) else 1)
