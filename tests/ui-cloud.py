"""Tinfoil cloud chats in the production renderer with synthetic state. Never connects to Tinfoil cloud."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);args=p.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
fixture='''
window.__cloudPatch=patch=>{previewCloud={...previewCloud,...patch};emit();};
window.__cloudChats=()=>{
  const now=Date.now(),base=workspace.threads[0];
  workspace.projects.push({id:'cloudproj',name:'Research',createdAt:now,cloud:{id:'8199999999999_p',etag:'1',description:'Papers.',instructions:'Cite sources.',color:'',documents:[],syncedAt:now}});
  workspace.threads.push({...structuredClone(base),id:'cloudstub',title:'Cloud trip',turns:[],projectId:null,pinned:false,updatedAt:now+2,cloud:{id:'8199999999999_a',etag:'2',project:null,turns:0,loaded:false,dirty:false,syncedAt:now}},
    {...structuredClone(base),id:'cloudpaper',title:'Cloud paper',projectId:'cloudproj',pinned:false,updatedAt:now+1,cloud:{id:'8199999999999_b',etag:'1',project:'8199999999999_p',turns:base.turns.length,loaded:true,dirty:false,syncedAt:now}});
  previewLoading=['cloudstub'];emit();};
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
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
    assert not errors,errors
    external=[u for u in requests if not u.startswith(('data:','blob:','about:'))];assert not external,external
    check('no JavaScript errors or external requests')
    browser.close()
out={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'scope':'Production renderer on Linux Chromium with synthetic cloud state; no Tinfoil account, chat key or network.'}
(root/'docs/ui-cloud-checks.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
