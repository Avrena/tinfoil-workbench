#!/usr/bin/python3
"""Project dependency environments inside one already-confined tool workspace.

These are separate venvs, npm prefixes and caches, not additional OS sandboxes.
The operator creates separately mounted/containerized workspaces with the CLI.
"""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


class Environments:
    def __init__(self, workspace=Path('/workspace')):
        self.workspace = Path(workspace).resolve(strict=True)
        self.root = self.workspace / '.environments'
        if self.root.is_symlink():
            raise ValueError('Environment registry cannot be a symlink.')
        self.root.mkdir(mode=0o700, exist_ok=True)
        if self.root.resolve(strict=True).parent != self.workspace:
            raise ValueError('Environment registry leaves workspace.')

    @contextmanager
    def lock(self, shared=False):
        fd = os.open(self.root / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_SH if shared else fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)

    def path(self, name, require=True):
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', name or ''):
            raise ValueError('Use a name with 1..40 lowercase letters, digits or hyphens, starting with a letter.')
        path = self.root / name
        if path.is_symlink() or path.resolve().parent != self.root:
            raise ValueError('Environment path leaves registry.')
        if require:
            marker = path / '.workbench-environment.json'
            if not path.is_dir() or marker.is_symlink():
                raise ValueError('Not a managed environment.')
            data = json.loads(marker.read_text())
            if data.get('name') != name or data.get('version') != 1:
                raise ValueError('Environment ownership marker does not match.')
        return path

    def init(self, name):
        with self.lock():
            path = self.path(name, require=False)
            path.mkdir(mode=0o700)  # Never overwrite an existing directory.
            marker = path / '.workbench-environment.json'
            marker.write_text(json.dumps({'name': name, 'version': 1, 'ready': False}))
            for part in ('.home', '.cache', '.npm-global', 'tmp'):
                (path / part).mkdir(mode=0o700)
            (path / 'package.json').write_text(json.dumps({'name': 'workspace-' + name, 'private': True, 'version': '0.0.0'}, indent=2) + '\n')
            subprocess.run(['/usr/bin/python3', '-m', 'venv', str(path / '.venv')], check=True)
            marker.write_text(json.dumps({'name': name, 'version': 1, 'ready': True}))
            return {'name': name, 'path': str(path), 'python': str(path / '.venv/bin/python')}

    def environment(self, path):
        marker = json.loads((path / '.workbench-environment.json').read_text())
        if marker.get('ready') is not True or not (path / '.venv/bin/python').is_file():
            raise ValueError('Environment initialization did not complete.')
        for part in ('.home', '.cache', '.npm-global', 'tmp', '.venv'):
            target = path / part
            if target.is_symlink() or not target.is_dir():
                raise ValueError('Unsafe or incomplete environment directory.')
        return dict(os.environ,
                    HOME=str(path / '.home'), VIRTUAL_ENV=str(path / '.venv'),
                    PATH=f'{path}/.venv/bin:{path}/node_modules/.bin:{path}/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                    XDG_CACHE_HOME=str(path / '.cache'), PIP_CACHE_DIR=str(path / '.cache/pip'),
                    PIP_REQUIRE_VIRTUALENV='true', PIP_DISABLE_PIP_VERSION_CHECK='1',
                    NPM_CONFIG_CACHE=str(path / '.cache/npm'), NPM_CONFIG_PREFIX=str(path / '.npm-global'),
                    TMPDIR=str(path / 'tmp'))

    def run(self, name, argv):
        if not argv:
            raise ValueError('Supply a command after --.')
        with self.lock(shared=True):
            path = self.path(name)
            env = self.environment(path)
            return subprocess.run(argv, cwd=path, env=env).returncode

    def list(self):
        with self.lock(shared=True):
            result = []
            for path in sorted(self.root.iterdir()):
                if path.name.startswith('.'):
                    continue
                checked = self.path(path.name)
                result.append(json.loads((checked / '.workbench-environment.json').read_text()))
            return result

    def clean(self, name, confirm):
        if confirm != name:
            raise ValueError('Deletion requires --confirm with the exact environment name.')
        with self.lock():
            path = self.path(name)
            if not shutil.rmtree.avoids_symlink_attacks:
                raise ValueError('Safe directory removal is unavailable.')
            shutil.rmtree(path)
        return {'deletedEnvironment': name}

    def cache(self, name, apply=False):
        with self.lock(shared=not apply):
            path = self.path(name) / '.cache'
            if path.is_symlink() or not path.is_dir():
                raise ValueError('Cache cannot be a symlink or missing.')
            size = 0
            for base, dirs, files in os.walk(path, followlinks=False):
                for filename in files:
                    size += (Path(base) / filename).lstat().st_size
            if apply:
                if not shutil.rmtree.avoids_symlink_attacks:
                    raise ValueError('Safe directory removal is unavailable.')
                shutil.rmtree(path)
                path.mkdir(mode=0o700)
            return {'cache': str(path), 'bytes': size, 'removed': apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='op', required=True)
    sub.add_parser('doctor')
    sub.add_parser('list')
    sub.add_parser('init').add_argument('name')
    run = sub.add_parser('run')
    run.add_argument('name')
    run.add_argument('command', nargs=argparse.REMAINDER)
    clean = sub.add_parser('delete')
    clean.add_argument('name')
    clean.add_argument('--confirm', required=True)
    cache = sub.add_parser('cache')
    cache.add_argument('name')
    cache.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.op == 'doctor':
        names = ['python3', 'pip3', 'pipx', 'node', 'npm', 'git', 'gcc', 'g++', 'clang', 'cmake', 'ninja', 'gdb', 'rg', 'nmap', 'sqlmap', 'nikto', 'ffuf', 'gobuster', 'hydra', 'john']
        print(json.dumps({'uid': os.getuid(), 'commands': {n: shutil.which(n) for n in names}}, indent=2))
        return 0
    envs = Environments()
    if args.op == 'run':
        return envs.run(args.name, args.command[1:] if args.command[:1] == ['--'] else args.command)
    if args.op == 'init':
        result = envs.init(args.name)
    elif args.op == 'delete':
        result = envs.clean(args.name, args.confirm)
    elif args.op == 'cache':
        result = envs.cache(args.name, args.apply)
    else:
        result = envs.list()
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
