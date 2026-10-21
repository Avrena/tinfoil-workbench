#!/usr/bin/python3
"""Operator workspace administration. Cleanup previews; deletion archives first."""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys


def request(value):
    response = subprocess.run(['/usr/local/bin/tinfoil-workbench'], input=json.dumps(value),
                              text=True, stdout=subprocess.PIPE, check=False)
    result = json.loads(response.stdout)
    if response.returncode or not result.get('ok'):
        raise ValueError(result.get('error', 'Controller failed.'))
    return result['result']


def main():
    if os.geteuid() != 0 or os.environ.get('SUDO_USER') == 'tinfoil-runner':
        raise ValueError('Operator SSH access required.')
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='op', required=True)
    sub.add_parser('list')
    create = sub.add_parser('create')
    create.add_argument('--name', required=True)
    create.add_argument('--profile', choices=['dev', 'kali'], default='dev')
    cleanup = sub.add_parser('cleanup')
    cleanup.add_argument('--days', type=int, default=7)
    sub.add_parser('archive').add_argument('id')
    delete = sub.add_parser('delete')
    delete.add_argument('id')
    delete.add_argument('--confirm', required=True)
    run = sub.add_parser('run', help='Run a bounded command in an idle workspace container.')
    run.add_argument('id')
    run.add_argument('--timeout', type=int, default=120)
    run.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if hasattr(args, 'id') and not re.fullmatch('[a-f0-9]{32}', args.id):
        raise ValueError('Invalid workspace ID.')
    if args.op == 'run':
        argv = args.command[1:] if args.command[:1] == ['--'] else args.command
        if not argv:
            raise ValueError('Supply a command after --.')
        # The controller serializes this check and execution against submit/delete.
        result = request({'op': 'operator-tool', 'id': args.id, 'name': 'run_command',
                          'arguments': json.dumps({'command': shlex.join(argv), 'workdir': '.', 'timeout_seconds': args.timeout})})
        print(result.get('stdout', ''), end='')
        print(result.get('stderr', ''), end='', file=sys.stderr)
        return result.get('exitCode') if isinstance(result.get('exitCode'), int) else 1
    if args.op == 'create':
        result = request({'op': 'create', 'name': args.name, 'profile': args.profile})
    elif args.op == 'cleanup':
        result = {'dryRun': True, 'candidates': request({'op': 'cleanup', 'days': args.days})}
    elif args.op == 'delete':
        if args.confirm != args.id:
            raise ValueError('--confirm must match the exact workspace ID.')
        archive = request({'op': 'archive', 'id': args.id})
        print(json.dumps(archive), file=sys.stderr)
        result = dict(request({'op': 'delete', 'id': args.id, 'confirm': args.confirm}), **archive)
    else:
        result = request({'op': args.op, **({'id': args.id} if hasattr(args, 'id') else {})})
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
