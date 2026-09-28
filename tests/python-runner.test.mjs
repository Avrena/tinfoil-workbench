import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { runPython } from '../desktop/python-runner.mjs';
const candidates=process.env.WORKBENCH_TEST_PYTHON?[process.env.WORKBENCH_TEST_PYTHON]:process.platform==='win32'?['python','py']:['python3','python'];
let interpreter;
for(const command of candidates){const probe=spawnSync(command,['-c','import sys; print(sys.executable)'],{encoding:'utf8',windowsHide:true});if(probe.status===0){interpreter=probe.stdout.trim();break;}}
const native=interpreter?test:test.skip;
const run=(code,extra={})=>runPython({code,interpreter,signal:new AbortController().signal,...extra});
native('native Python captures Unicode stdout and stderr separately',async()=>{const r=await run('import sys\nprint("你好")\nprint("warning", file=sys.stderr)');assert.equal(r.status,'complete');assert.equal(r.stdout.trim(),'你好');assert.equal(r.stderr.trim(),'warning');});
native('native Python returns exceptions as error results',async()=>{const r=await run('raise ValueError("fixture")');assert.equal(r.status,'error');assert.equal(r.exitCode,1);assert.match(r.stderr,/ValueError: fixture/);});
native('native Python enforces runtime timeout',async()=>{const r=await run('import time\ntime.sleep(30)',{timeoutMs:150});assert.equal(r.status,'error');assert.match(r.stderr,/time limit/);assert.ok(r.elapsedMs<5000);});
native('native Python can be cancelled while running',async()=>{const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),150);try{const r=await run('import time\ntime.sleep(30)',{signal:ctrl.signal});assert.equal(r.status,'cancelled');}finally{clearTimeout(timer);}});
native('native Python bounds output and stops excessive printing',async()=>{const r=await run('print("x"*200000)');assert.equal(r.status,'error');assert.equal(r.truncated,true);assert.ok(r.stdout.length<=100000);});
native('generated supported files are collected, oversized and executable files ignored',async()=>{const r=await run('from pathlib import Path\np=Path("artifacts")\n(p/"result.json").write_text("{\\"answer\\":42}")\n(p/"bad.exe").write_bytes(b"MZ")\n(p/"large.txt").write_bytes(b"x"*2200000)');assert.equal(r.status,'complete');assert.equal(r.artifacts.length,1);assert.equal(r.artifacts[0].name,'result.json');assert.equal(Buffer.from(r.artifacts[0].data,'base64').toString(),'{"answer":42}');});
native('Python environment omits API secrets and temporary work directory is removed',async()=>{process.env.TINFOIL_API_KEY='test-secret-never-inherit';try{const r=await run('import os\nprint(os.getcwd())\nprint(os.environ.get("TINFOIL_API_KEY", "absent"))');const [cwd,value]=r.stdout.trim().split(/\r?\n/);assert.equal(value,'absent');await assert.rejects(access(cwd));}finally{delete process.env.TINFOIL_API_KEY;}});
test('native Python refuses relative executables and invalid code',async()=>{await assert.rejects(runPython({code:'print(1)',interpreter:'python'}));await assert.rejects(runPython({code:'',interpreter:'/missing/python'}));});
test('missing Python executable returns a bounded startup error',async()=>{await assert.rejects(runPython({code:'print(1)',interpreter:process.platform==='win32'?'C:\\definitely-missing\\python.exe':'/definitely-missing/python'}),/could not start/);});
