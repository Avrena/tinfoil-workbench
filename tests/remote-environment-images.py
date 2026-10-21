"""Exercise installed tool images with synthetic files and no external network.
Requires operator Docker access; does not use provider accounts or real workspaces.
"""
import argparse
import json
from pathlib import Path
import subprocess

script = r'''
import json, os, platform, shutil, socket, struct, subprocess, time
from pathlib import Path
base = Path('/workspace/probe')
base.mkdir()
Path('/workspace/.home').mkdir()
os.chdir(base)
assert os.getuid() == 1000
assert not Path('/var/run/docker.sock').exists()
assert not Path('/etc/tinfoil-workbench').exists()
assert not Path('/run/credentials').exists()
assert 'CapEff:\t0000000000000000' in Path('/proc/self/status').read_text()
try:
    Path('/etc/workbench-write-test').write_text('forbidden')
    raise AssertionError('Root filesystem unexpectedly writable')
except OSError:
    pass
def run(*argv):
    value = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    assert value.returncode == 0, (argv, value.returncode, value.stdout, value.stderr)
    return value.stdout.strip() or value.stderr.strip()
versions = {}
for tool in ['python3', 'pip3', 'pipx', 'node', 'npm', 'git', 'gcc', 'g++', 'clang', 'cmake', 'ninja', 'gdb', 'make', 'pkg-config', 'rg', 'shellcheck']:
    assert shutil.which(tool), tool
    versions[tool] = run(tool, '--version').splitlines()[0]
Path('probe.c').write_text('#include <stdio.h>\nint main(void){puts("c-ok");return 0;}\n')
Path('probe.cpp').write_text('#include <iostream>\nint main(){constexpr int x=42;std::cout<<x<<"\\n";}\n')
run('gcc', 'probe.c', '-o', 'gcc-probe')
run('clang', 'probe.c', '-o', 'clang-probe')
run('g++', '-std=c++20', 'probe.cpp', '-o', 'cxx-probe')
assert run('./gcc-probe') == 'c-ok'
assert run('./clang-probe') == 'c-ok'
assert run('./cxx-probe') == '42'
Path('CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.16)\nproject(probe C)\nadd_executable(cmake-probe probe.c)\n')
run('cmake', '-S', '.', '-B', 'build', '-G', 'Ninja')
run('cmake', '--build', 'build', '--parallel', '1')
assert run('./build/cmake-probe') == 'c-ok'
run('workbench-env', 'init', 'builder')
run('workbench-env', 'init', 'reviewer')
a = run('workbench-env', 'run', 'builder', '--', 'python', '-c', 'import sys;print(sys.prefix)')
b = run('workbench-env', 'run', 'reviewer', '--', 'python', '-c', 'import sys;print(sys.prefix)')
assert a != b and '/builder/' in a and '/reviewer/' in b
run('workbench-env', 'run', 'builder', '--', 'npm', 'init', '-y')
run('workbench-env', 'run', 'builder', '--', 'node', '-e', 'if(!require("./package.json").private)process.exit(1)')
cache = Path('/workspace/.environments/builder/.cache/test')
cache.write_text('keep-until-apply')
assert not json.loads(run('workbench-env', 'cache', 'builder'))['removed']
assert cache.exists()
run('workbench-env', 'cache', 'builder', '--apply')
assert not cache.exists()
assert Path('/workspace/.environments/reviewer/.venv/bin/python').exists()
run('workbench-env', 'delete', 'builder', '--confirm', 'builder')
assert Path('/workspace/.environments/reviewer/.venv/bin/python').exists()
if shutil.which('nmap'):
    for tool in ['nmap', 'ncat', 'dig', 'whois', 'nc', 'socat', 'tcpdump', 'tshark', 'openssl', 'sqlmap', 'nikto', 'whatweb', 'ffuf', 'gobuster', 'hydra', 'john']:
        assert shutil.which(tool), tool
    for argv in [('nmap','--version'),('sqlmap','--version'),('nikto','-Version'),('whatweb','--version'),('ffuf','-V'),('gobuster','--version'),('john','--list=build-info')]:
        versions[argv[0]] = run(*argv).splitlines()[0]
    Path('empty.pcap').write_bytes(struct.pack('<IHHIIII',0xa1b2c3d4,2,4,0,0,65535,1))
    run('tshark', '-r', 'empty.pcap', '-c', '1')
    server = subprocess.Popen(['python3','-m','http.server','8173','--bind','127.0.0.1'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                with socket.create_connection(('127.0.0.1',8173), timeout=0.1): break
            except OSError: time.sleep(0.1)
        assert '8173/tcp open' in run('nmap','-sT','-Pn','-p','8173','127.0.0.1')
    finally:
        server.terminate()
        server.wait(timeout=5)
print(json.dumps({'os':platform.freedesktop_os_release()['PRETTY_NAME'], 'uid':os.getuid(), 'versions':versions,
                  'checks':['C, C++, Clang, CMake/Ninja build and execute','separate Python venvs and npm projects',
                            'cache dry-run, scoped apply and exact environment removal','non-root, no capabilities, read-only root, no Docker socket/credentials',
                            'Kali tool startup, local-only TCP scan and offline PCAP read' if shutil.which('nmap') else 'development profile']}, indent=2))
'''
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dev-image', default='tinfoil-workbench-tools:1')
parser.add_argument('--kali-image', default='tinfoil-workbench-kali:1')
parser.add_argument('--report', type=Path)
args = parser.parse_args()
results = {}
for profile, image in [('tools', args.dev_image), ('kali', args.kali_image)]:
    command = "python3 - <<'PY'\n" + script + '\nPY'
    payload = json.dumps({'name':'run_command', 'arguments':json.dumps({'command':command, 'workdir':'.', 'timeout_seconds':180})})
    argv = ['docker','run','--rm','-i','--network=none','--user=1000:1000','--read-only','--cap-drop=ALL',
            '--security-opt=no-new-privileges','--memory=768m','--memory-swap=768m','--cpus=1','--pids-limit=128',
            '--tmpfs','/tmp:rw,nosuid,nodev,size=128m,mode=1777','--tmpfs','/workspace:rw,exec,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=700',image]
    result = subprocess.run(argv, input=payload, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=220)
    assert result.returncode == 0, result.stderr + result.stdout
    output = json.loads(result.stdout)
    assert output['ok'], output
    assert output['result']['exitCode'] == 0, output['result']
    results[profile] = json.loads(output['result']['stdout'])
    print(json.dumps({profile:results[profile]}, indent=2), flush=True)
if args.report:
    args.report.write_text(json.dumps(results, indent=2) + '\n')
