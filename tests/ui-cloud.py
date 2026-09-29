"""Tinfoil cloud chats in the production renderer with synthetic state. Never connects to Tinfoil cloud."""
import argparse,json,re,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);args=p.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
fixture='''
window.__cloudPatch=patch=>{previewCloud={...previewCloud,...patch};emit();};
window.__cloudChats=()=>{
  const now=Date.now(),base=workspace.threads[0];
  workspace.projects.push({id:'cloudproj',name:'Research',createdAt:now,cloud:{id:'8199999999999_p',etag:'1',description:'Papers.',instructions:'Cite sources.',color:'',documents:[],syncedAt:now}});
  workspace.threads.push({...structuredClone(base),id:'cloudstub',title:'Cloud trip',turns:[],projectId:null,pinned:false,updatedAt:now+2,cloud:{id:'8199999999999_a',etag:'2',project:null,turns:0,loaded:false,dirty:false,syncedAt:now}},
    {...structuredClone(base),id:'cloudpaper',title:'Cloud paper',projectId:'cloudproj',pinned:false,updatedAt:now+1,cloud:{id:'8199999999999_b',etag:'1',project:'8199999999999_p',turns:base.turns.length,loaded:true,dirty:false,syncedAt:now}});
  previewLoading=['cloudstub'];emit();};
window.__cloudThread=t=>{workspace.threads.push(t);workspace.activeId=t.id;emit();};
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
# A Tinfoil Chat answer with widgets between its paragraphs, read by the real threadFromCloud() from the build.
WIDGET_CHAT=r'''
import {threadFromCloud} from './dist/core/cloud.js';
const call=(id,name,args)=>({type:'tool_call',id:'b'+id,toolCallId:'call_'+id,name,arguments:JSON.stringify(args)});
const timeline=[{type:'content',id:'c1',content:'Revenue grew quickly.\n\n'},
  call(1,'render_chart',{type:'bar',title:'Revenue by year',data:[{year:'2023',revenue:1},{year:'2024',revenue:4.5},{year:'2025',revenue:9}]}),
  {type:'content',id:'c2',content:'The main milestones:\n\n'},call(2,'render_timeline',{events:[{date:'2021',title:'Founded'},{date:'2023',title:'First model'}]}),
  call(3,'render_map',{query:'San Francisco'}),{type:'content',id:'c3',content:'That is the picture.'}];
const content=timeline.filter(b=>b.type==='content').map(b=>b.content).join('');
const chat={title:'Cloud widgets',createdAt:'2026-09-20T10:00:00.000Z',updatedAt:'2026-09-21T10:00:00.000Z',model:'kimi-k3',messages:[{role:'user',content:'How has revenue grown?'},{role:'assistant',content,timeline}]};
process.stdout.write(JSON.stringify(threadFromCloud(chat,{id:'8199999999999_w',etag:'1',project:null},null,Date.parse('2026-09-29T12:00:00Z'))));
'''
widget_thread=json.loads(subprocess.run(['node','--input-type=module','-e',WIDGET_CHAT],cwd=root,capture_output=True,text=True,check=True).stdout)
def check(label):checks.append(label)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.wait_for_selector('#prompt')
    page.locator('#account-footer').click();section=page.locator('.cloud-section')
    expect(section).to_contain_text('Tinfoil cloud chats');expect(section).to_contain_text('Sign in to Tinfoil Chat first');assert section.locator('input').count()==0
    check('signed out, the cloud section explains itself and offers no key field')
    page.locator('[data-action=account-sample]').click();key=page.locator('#cloud-key')
    expect(key).to_have_attribute('type','password');expect(key).to_have_attribute('autocomplete','off');expect(section).to_contain_text('changes it in your Tinfoil account too')
    page.locator('[data-action=cloud-connect]').click();expect(page.locator('#toast')).to_contain_text('Paste your chat key first')
    key.fill('key_'+'a'*64);page.locator('[data-action=cloud-connect]').click();expect(page.locator('#toast')).to_contain_text('Offline preview cannot connect to Tinfoil cloud');expect(key).to_have_value('')
    page.locator('[data-action=cloud-key-file]').click();expect(page.locator('#toast')).to_contain_text('Offline preview cannot connect')
    check('signed in, the chat key is masked, cleared after use, and the preview refuses to connect')
    page.evaluate("window.__cloudPatch({state:'ready',keyId:'0123456789abcdef0123456789abcdef',user:'user_sample',lastSyncAt:Date.now(),chats:2,projects:1,older:1})")
    state=page.locator('.cloud-state');expect(state).to_contain_text('Synced at');expect(state).to_contain_text('2 chats · 1 project')
    expect(section).to_contain_text('Only your 300 most recent cloud chats');expect(section).to_contain_text('Key ID 01234567…');assert section.locator('input').count()==0
    expect(page.locator('[data-action=cloud-sync]')).to_be_enabled();expect(page.locator('[data-action=cloud-disconnect]')).to_have_text('Remove chat key…')
    page.evaluate("window.__cloudPatch({state:'syncing'})");expect(state).to_contain_text('Syncing');expect(page.locator('[data-action=cloud-sync]')).to_be_disabled()
    page.evaluate("window.__cloudPatch({state:'error',message:'These cloud chats belong to another Tinfoil account.'})");expect(state).to_contain_text('Sync stopped');expect(section).to_contain_text('another Tinfoil account')
    page.evaluate("window.__cloudPatch({state:'ready',message:null})");page.screenshot(path=str(root/'docs/cloud-account.png'))
    check('connected, the section shows sync state, counts, the listing limit, errors and the key ID, never the key')
    page.keyboard.press('Escape');page.evaluate('window.__cloudChats()')
    stub=page.locator('[data-thread=cloudstub]');expect(stub).to_have_class(re.compile(r'\bcloud\b'));expect(stub).to_contain_text('Loading from Tinfoil cloud');expect(stub).to_have_attribute('title','Cloud trip (Tinfoil cloud)')
    group=page.locator('.project-group[aria-label=Research]');expect(group.locator('.project-toggle')).to_have_attribute('title','Tinfoil cloud project')
    assert group.locator('[data-action=project-manage]').count()==0;expect(group).to_contain_text('Cloud paper')
    check('cloud chats and projects are marked in the sidebar, and cloud projects offer no local management')
    menu=page.locator('.export-menu summary');menu.click();expect(page.locator('#cloud-upload')).to_be_visible();page.keyboard.press('Escape')
    stub.click();expect(page.locator('.cloud-loading')).to_contain_text('Loading from Tinfoil cloud');expect(page.locator('.empty-mark')).to_have_count(0)
    menu.click();expect(page.locator('#cloud-upload')).to_be_hidden();page.keyboard.press('Escape')
    page.screenshot(path=str(root/'docs/cloud-sidebar.png'))
    page.evaluate("window.__cloudPatch({state:'off',keyId:null})");menu.click();expect(page.locator('#cloud-upload')).to_be_hidden()
    check('a listed chat shows that it is loading, and Move to Tinfoil cloud appears only for local conversations while connected')
    page.evaluate('t=>window.__cloudThread(t)',widget_thread);figs=page.locator('.inline-artifact');expect(figs).to_have_count(2)
    for i in range(2):figs.nth(i).scroll_into_view_if_needed();expect(figs.nth(i).locator('.inline-artifact-stage')).to_have_attribute('aria-busy','false')
    order=page.evaluate('''()=>[...document.querySelectorAll('.inline-artifact, .reply-content p')].filter(e=>e.matches('.inline-artifact')||!e.closest('.inline-artifact'))
      .map(e=>e.matches('.inline-artifact')?'figure: '+e.querySelector('.inline-artifact-header strong').textContent:e.textContent.trim())''')
    assert order==['Revenue grew quickly.','figure: Revenue by year','The main milestones:','figure: Timeline','That is the picture.'],order
    expect(figs.nth(0).locator('svg .chart-mark')).to_have_count(3);expect(figs.nth(1).locator('.wb-timeline li')).to_have_count(2)
    runs=page.locator('.tool-activity').last;expect(runs.locator('summary')).to_contain_text('3 tool runs');runs.locator('summary').click()
    expect(runs).to_contain_text('Tinfoil Chat showed a map here, which Workbench does not display.')
    check('a synced answer\'s chart and timeline appear where Tinfoil Chat shows them, and a map is listed as not displayed')
    assert not errors,errors
    external=[u for u in requests if not u.startswith(('data:','blob:','about:'))];assert not external,external
    check('no JavaScript errors or external requests')
    browser.close()
out={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'scope':'Production renderer on Linux Chromium with synthetic cloud state; no Tinfoil account, chat key or network.'}
(root/'docs/ui-cloud-checks.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
