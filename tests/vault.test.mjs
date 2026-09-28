import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EncryptedVault } from '../desktop/vault.mjs';
// A test double only: real Windows DPAPI is tested separately by smoke:desktop.
const protector={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'tinfoil-vault-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {dir,v:new EncryptedVault(dir,protector)};}
test('encrypted vault round-trips without plaintext conversation or credentials',async t=>{
  const {dir,v}=await fixture(t);assert.equal(await v.read(),null);await v.write({apiKey:'never-on-disk-plaintext',prompt:'confidential conversation'});
  const raw=await readFile(join(dir,'workspace.vault'),'utf8');assert.ok(!raw.includes('never-on-disk-plaintext'));assert.ok(!raw.includes('confidential conversation'));
  const fresh=new EncryptedVault(dir,protector);assert.deepEqual(await fresh.read(),{apiKey:'never-on-disk-plaintext',prompt:'confidential conversation'});
});
test('concurrent vault writes are serialized, with newest snapshot winning',async t=>{
  const {dir,v}=await fixture(t);await v.read();const state={n:0};const jobs=[];
  for(let n=0;n<12;n++){state.n=n;jobs.push(v.write(state));}await Promise.all(jobs);await v.flush();
  assert.equal((await new EncryptedVault(dir,protector).read()).n,11);
});
test('authenticated encryption rejects modified ciphertext without resetting it',async t=>{
  const {dir,v}=await fixture(t);await v.read();await v.write({private:'hello'});const path=join(dir,'workspace.vault');
  const raw=JSON.parse(await readFile(path,'utf8'));const body=Buffer.from(raw.body,'base64');body[0]^=1;raw.body=body.toString('base64');
  const damaged=JSON.stringify(raw);await writeFile(path,damaged);await assert.rejects(new EncryptedVault(dir,protector).read());assert.equal(await readFile(path,'utf8'),damaged);
});
test('unavailable OS encryption fails closed',async t=>{
  const {dir}=await fixture(t);const v=new EncryptedVault(dir,{isEncryptionAvailable:()=>false});await assert.rejects(v.read(),/Plaintext storage is not permitted/);
});
test('wrong OS key and malformed vault versions are rejected',async t=>{
  const {dir,v}=await fixture(t);await v.read();await v.write({n:1});const wrong={...protector,decryptString:()=>Buffer.alloc(32,42).toString('base64')};
  await assert.rejects(new EncryptedVault(dir,wrong).read());const path=join(dir,'workspace.vault');const raw=JSON.parse(await readFile(path,'utf8'));raw.version=99;await writeFile(path,JSON.stringify(raw));await assert.rejects(new EncryptedVault(dir,protector).read(),/Unsupported/);
});
