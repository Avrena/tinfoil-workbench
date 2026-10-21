import { spawn } from 'node:child_process';
import { InputError } from '../dist/core/validation.js';
import { remoteAlias } from '../dist/core/remote.js';

/** One SSH connection per host. Requests are bounded JSON lines to a fixed
 * controller; no interactive shell or caller-provided remote command exists. */
export function createSSHTransport(oneShot, spawnProcess = spawn) {
  const connections = new Map();
  function connection(alias) {
    const existing = connections.get(alias); if (existing) return existing;
    const child = spawnProcess('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2',
      alias, '/usr/local/bin/tinfoil-workbench --serve'], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
    const state = { child, queue:Promise.resolve(), pending:null, buffer:'', stderr:'', closed:false };
    const fail = error => {
      if(state.closed)return;state.closed=true;connections.delete(alias);child.kill();
      if(state.pending){clearTimeout(state.pending.timer);state.pending.reject(error);state.pending=null;}
    };
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stderr.on('data',data=>{state.stderr=(state.stderr+data).slice(-8000);});
    child.stdout.on('data',data=>{
      state.buffer+=data;
      if(Buffer.byteLength(state.buffer)>3*1024*1024){fail(new InputError('The remote response exceeded its display limit.'));return;}
      let newline;
      while((newline=state.buffer.indexOf('\n'))>=0){
        const line=state.buffer.slice(0,newline);state.buffer=state.buffer.slice(newline+1);
        const pending=state.pending;
        if(!pending){fail(new InputError('The remote controller sent an unexpected response.'));return;}
        let result;try{result=JSON.parse(line);}catch{fail(new InputError('The remote controller returned invalid data.'));return;}
        clearTimeout(pending.timer);state.pending=null;
        if(result?.ok===true)pending.resolve(result.result);
        else if(result?.ok===false&&typeof result.error==='string')pending.reject(Object.assign(new InputError(result.error.slice(0,2000)),{remoteRejected:true}));
        else{pending.reject(new InputError('The remote controller returned invalid data.'));fail(new InputError('Connection closed.'));}
      }
    });
    child.on('error',()=>fail(new InputError('OpenSSH could not start. Install the Windows OpenSSH client.')));
    child.on('close',()=>fail(new InputError(/REMOTE HOST IDENTIFICATION HAS CHANGED/.test(state.stderr)
      ? 'The SSH host key changed. Verify the server identity in OpenSSH before reconnecting.'
      : /host key verification failed/i.test(state.stderr)?'The SSH host key is not trusted. Verify it in OpenSSH before connecting.'
      : /permission denied/i.test(state.stderr)?'SSH refused the login key. Check the alias or load the key into ssh-agent.'
      : 'SSH disconnected. Refresh jobs before submitting again; work may continue on the host. Check SSH and the remote worker installation.')));
    child.stdin.on('error',()=>fail(new InputError('The SSH request could not be sent. Refresh jobs before submitting again.')));
    state.fail=fail;connections.set(alias,state);return state;
  }
  const request = (alias, payload) => {
    remoteAlias(alias);
    // An archive can occupy the main connection. Stop gets an independent fixed
    // controller request and bypasses the server lifecycle lock.
    if(payload.op==='stop')return oneShot(alias,payload);
    const state=connection(alias);
    const run=state.queue.then(()=>{
      if(state.closed)throw new InputError('SSH disconnected before this request was sent. Refresh to reconnect.');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>state.fail(new InputError('The remote request timed out. Refresh jobs to check its outcome; no action was retried.')),payload.op==='archive'?330000:60000);
        state.pending={resolve,reject,timer};
        state.child.stdin.write(JSON.stringify(payload)+'\n');
      });
    });
    state.queue=run.catch(()=>{});return run;
  };
  request.close=()=>{for(const state of connections.values())state.fail(new InputError('Workbench is closing; remote jobs keep running.'));connections.clear();};
  return request;
}
