"""v0.8 production renderer: synthetic snapshots, never live requests or approvals."""
import argparse,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = (ms) => new Promise((r) => setTimeout(r, ms));'
fixture=r'''
window.__activitySeed=(mode='approval')=>{
 const t=workspace.threads.find(t=>t.id===workspace.activeId);t.title='Tool activity · synthetic demonstration';
 const base=(id,name,status)=>({id,callId:id,name,arguments:'{}',origin:'model',status,stdout:'',stderr:'',exitCode:null,elapsedMs:1500,artifacts:[],truncated:false});
 const a=base('check','read_artifact','complete');a.arguments=JSON.stringify({artifact_id:'sample'});a.stdout='{"rows": 3}';
 const d=base('delegate','delegate_task',mode==='approval'?'awaiting_approval':mode==='running'?'running':'complete');d.arguments=JSON.stringify({task:'Review only the three supplied values: 142, 180 and 218 seconds.'});d.delegate={task:'Review only the three supplied values: 142, 180 and 218 seconds.',model:'demo/writer',content:mode==='approval'?'':'The mean is **180 seconds**.\n\n$$\\bar{x}=180$$',reasoning:mode==='approval'?'':'Synthetic child reasoning: separate arithmetic from the decision.',phase:'answering',usage:{input:45,output:36}};
 const third=base('third','python',mode==='complete'?'denied':'queued');third.arguments=JSON.stringify({code:'print(sum([142,180,218])/3)'});if(mode==='complete')third.stderr='The user declined this local run.';
 const search=base('search','search','complete');Object.assign(search,{origin:'provider',arguments:'{"query":"sample documentation"}',provider:{itemId:'provider-fixture',round:0,family:'web_search',sources:[{url:'https://docs.tinfoil.sh',title:'Tinfoil documentation'}]},stdout:'Synthetic provider result, not a network response.'});
 [a,d,third].forEach((x,i)=>Object.assign(x,{batchId:'batch-fixture',batchIndex:i,batchSize:3}));
 const r={id:'activity-reply',model:'demo/writer',content:'These actions are shown as a single batch. Each action keeps its own result and approval.\n\nThis is a **synthetic fixture**, not a live provider request.',reasoning:'Main model reasoning fixture.',status:mode==='complete'?'complete':mode==='approval'?'awaiting_approval':'executing',phase:'answering',error:null,elapsedMs:2000,usage:{input:128,output:64},tools:[a,d,third,search]};
 t.turns=[{id:'activity-turn',prompt:'Inspect the measurements with a second analysis, and show the actions.',createdAt:1,attachments:[],selectedReplyId:r.id,replies:[r]}];busy=mode==='complete'?null:t.id;emit();
 window.__activityReply=()=>r;
 window.__activityPatch=(id,patch)=>{Object.assign(r.tools.find(x=>x.id===id),patch);emit();};
 window.__activityView=patch=>{workspace.view=require('/core/preferences.js').viewPreferences({...workspace.view,...patch});emit();};
};
window.__activityWorkspace=()=>structuredClone(workspace);
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.wait_for_selector('#prompt');page.evaluate('window.__activitySeed()')
 strip=page.locator('.activity-strip');expect(strip).to_have_count(1);assert strip.get_attribute('open') is None;expect(strip.locator('> summary .tick:not(.tick-out)')).to_contain_text('Delegated analysis');expect(strip.locator('.activity-count')).to_have_text('4 tool runs · MCP · sub-agent')
 checks.append('all of a reply\'s calls share one closed row that names the call in progress and counts them all')
 expect(page.locator('.batch-heading')).to_contain_text('Batch · 3 actions');expect(page.locator('.batch-heading')).to_contain_text('1 done');expect(page.locator('.batch-heading')).to_contain_text('1 queued');expect(page.locator('.batch-heading')).to_contain_text('one after another');checks.append('inside the row, same-round actions are grouped with honest queued, completed and approval counts')
 expect(page.locator('[data-tool-id=delegate] .approval-warning')).to_contain_text('Additional inference usage');expect(page.locator('[data-tool-id=delegate] .approval-warning')).not_to_contain_text('Python');expect(page.locator('[data-tool-id=delegate] pre')).to_contain_text('142, 180 and 218');checks.append('approval shows the exact task, extra usage and context scope without a misleading Python warning')
 assert page.locator('[data-action=approve-tool]').count()==1;assert page.locator('[data-action=deny-tool]').count()==1;assert page.locator('[data-action=approve-all]').count()==0;checks.append('only the active protected action is approvable; queued items do not gain approve-all controls')
 page.evaluate("window.__activityView({reasoning:'hidden'})");expect(page.locator('.reasoning')).to_have_count(0);expect(page.locator('[data-action=approve-tool]')).to_be_visible();checks.append('hiding model reasoning never hides protected-action approval')
 assert page.locator('[data-tool-id=third] [data-activity-body]').inner_html()=='';checks.append('closed queued detail islands do not build source or output content')
 page.locator('[data-action=approve-tool]').click();expect(page.locator('#toast')).to_contain_text('Offline preview');expect(page.locator('[data-tool-id=delegate]')).to_have_attribute('data-state','awaiting_approval');checks.append('the offline preview refuses execution instead of simulating approval success')
 page.evaluate("window.__activitySeed('running');window.__activityView({reasoning:'collapsed'})")
 expect(page.locator('.response-activity')).to_contain_text('Sub-agent working');expect(page.locator('[data-action=cancel-delegate]')).to_be_visible();assert page.locator('[data-tool-id=delegate] [data-activity-body]').inner_html()=='';checks.append('running delegated work has its own stop action and lazy live-result disclosure')
 page.locator('[data-tool-id=delegate] .activity-item-details > summary').click();expect(page.locator('.delegate-answer')).to_contain_text('180 seconds');assert page.locator('.delegate-answer strong').count()==1;assert page.locator('.delegate-answer math').count()==1;expect(page.locator('.delegate-usage')).to_contain_text('45 in · 36 out');checks.append('delegated answers render Markdown and mathematics with separately reported usage')
 assert page.locator('[data-child-reasoning]').inner_html()=='';page.locator('.delegate-thinking > summary').click();expect(page.locator('[data-child-reasoning]')).to_contain_text('Synthetic child reasoning');checks.append('child reasoning is separate, explicitly provider-returned, and only rendered when requested')
 page.evaluate("window.__activityReply().tools.find(t=>t.id==='delegate').delegate.content+=' Updated finding.';window.__activityPatch('delegate',{});")
 expect(page.locator('.delegate-answer')).to_contain_text('Updated finding.');assert page.locator('[data-tool-id=delegate] .activity-item-details').get_attribute('open') is not None;assert page.locator('.delegate-thinking').get_attribute('open') is not None;checks.append('stream updates retain opened child answer and reasoning disclosures')
 ticker=page.locator('.activity-strip > summary .activity-ticker');expect(ticker.locator('.tick:not(.tick-out)')).to_contain_text('Delegated analysis')
 page.evaluate("window.__activityPatch('delegate',{status:'complete'});window.__activityPatch('third',{status:'running'})")
 expect(ticker.locator('.tick:not(.tick-out)')).to_contain_text('python');expect(ticker.locator('.tick-out')).to_have_attribute('data-key','tick-delegate');expect(ticker.locator('.tick-out')).to_have_attribute('aria-hidden','true')
 assert ticker.locator('.tick:not(.tick-out)').evaluate('e=>getComputedStyle(e).animationName')=='tick-in';assert ticker.locator('.tick-out').evaluate('e=>getComputedStyle(e).animationName')=='tick-out'
 page.wait_for_timeout(400);assert ticker.locator('.tick-out').evaluate('e=>getComputedStyle(e).visibility')=='hidden';assert page.locator('.activity-strip').count()==1
 checks.append('the next call rolls into the row as the last one rolls out, then the outgoing call is hidden; the row stays a single line')
 page.evaluate("""async()=>{const r=window.__activityReply(),base=r.tools[0];window.__activityPatch('third',{status:'complete'});window.__ticks=[];let on=true;
  const log=()=>{if(!on)return;window.__ticks.push([...document.querySelectorAll('.activity-strip > summary .tick')].map(x=>{const c=getComputedStyle(x),b=x.getBoundingClientRect();return {out:x.classList.contains('tick-out'),text:x.textContent.trim(),vis:c.visibility,op:+c.opacity,top:b.top,bottom:b.bottom};}));requestAnimationFrame(log);};requestAnimationFrame(log);
  for(const name of ['one','two','three']){const x={...base,id:'burst-'+name,callId:'burst-'+name,arguments:JSON.stringify({title:name}),status:'running'};delete x.batchId;delete x.batchIndex;delete x.batchSize;r.tools.push(x);window.__activityPatch(x.id,{});await new Promise(f=>setTimeout(f,40));x.status='complete';}
  await new Promise(f=>setTimeout(f,700));on=false;}""")
 shown=[]
 for frame in page.evaluate('window.__ticks'):
  current=[t['text'] for t in frame if not t['out']]
  if current and (not shown or shown[-1]!=current[0]):shown.append(current[0])
  visible=[t for t in frame if t['vis']=='visible' and t['op']>0.02]
  assert not any(min(a['bottom'],b['bottom'])-max(a['top'],b['top'])>0.5 for i,a in enumerate(visible) for b in visible[i+1:]),frame
 assert shown[-1].endswith('three') and not any(s.endswith('two') for s in shown),shown
 checks.append('calls a few milliseconds apart never cut a roll short or draw two calls over each other: the row ends its roll, then shows the latest call')
 page.emulate_media(reduced_motion='reduce');assert page.locator('.activity-state.running').first.evaluate('e=>getComputedStyle(e).animationName')=='none';assert ticker.locator('.tick:not(.tick-out)').evaluate('e=>getComputedStyle(e).animationName')=='none';checks.append('running activity and the rolling row honor the system reduced-motion preference')
 page.evaluate("window.__activitySeed('complete')");strip=page.locator('.activity-strip');expect(strip).not_to_have_class(re.compile(r'\blive\b'));assert strip.get_attribute('open') is None
 expect(strip.locator('> summary .tick:not(.tick-out) .tick-text')).to_have_text('Read an artifact, delegated a task, searched the web · 1 declined');expect(page.locator('.batch-heading')).to_contain_text('2 done');expect(page.locator('.batch-heading')).to_contain_text('1 declined');checks.append('a finished reply\'s row says what was done, with accurate mixed-result counts, and stays closed')
 strip.locator('> summary').click();page.locator('[data-tool-id=third] .activity-item-details > summary').click();expect(page.locator('[data-tool-id=third] .tool-stderr')).to_contain_text('declined');checks.append('every batch result remains inspectable, including denied actions')
 group=strip;expect(page.locator('[data-tool-id=search] .tool-run-header')).to_contain_text('Tinfoil-managed MCP');expect(page.locator('.activity-origin')).to_contain_text('did not execute it locally');assert page.locator('[data-tool-id=search] [data-action=approve-tool]').count()==0;checks.append('provider MCP activity is labelled as an observation and cannot invoke local approval or execution')
 page.locator('.activity-sources button').click();expect(page.locator('#toast')).to_contain_text('does not open external links');checks.append('provider sources use the guarded URL path, and the preview blocks external navigation')
 page.evaluate("window.__activityPatch('third',{status:'error',stderr:'A failed action fixture.'})");expect(page.locator('.batch-heading')).to_contain_text('1 failed');expect(group.locator('> summary')).to_contain_text('1 failed');assert group.get_attribute('open') is not None;checks.append('failure updates keep the row open and replace stale outcome counts')
 page.evaluate("window.__activityView({reasoning:'hidden'})");expect(page.locator('.delegate-thinking')).to_have_count(0);checks.append('global reasoning visibility also covers child reasoning without discarding the saved text')
 page.keyboard.press('Control+n');page.locator('[data-action=inspector]').first.click();expect(page.locator('#web-search')).not_to_be_checked();expect(page.locator('#delegate-mode')).to_have_value('off');checks.append('new threads start with hosted search and delegated inference disabled')
 page.locator('#web-search').check();page.locator('#delegate-mode').select_option('ask');stored=page.evaluate('window.__activityWorkspace().threads.find(t=>t.id===window.__activityWorkspace().activeId).settings');assert stored['webSearch'] is False and stored['delegateMode']=='off';page.locator('#apply-settings').click();stored=page.evaluate('window.__activityWorkspace().threads.find(t=>t.id===window.__activityWorkspace().activeId).settings');assert stored['webSearch'] is True and stored['delegateMode']=='ask';checks.append('tool permissions are saved only by an explicit Apply settings action')
 page.close()
 for width,height,touch in [(320,740,True),(390,844,True),(820,1180,True),(1280,900,False)]:
  context=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch,device_scale_factor=1);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html);page.evaluate("window.__activitySeed('approval')");expect(page.locator('[data-action=approve-tool]')).to_be_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert page.locator('.activity-strip > summary').evaluate('e=>e.getBoundingClientRect().right<=innerWidth');checks.append(f'{width}px: the activity row and approval text fit without page-level horizontal overflow')
  buttons=page.locator('.approval-actions button');boxes=[buttons.nth(i).bounding_box() for i in range(buttons.count())]
  if width<=780:assert all(b['height']>=44 for b in boxes)
  a,b=boxes;assert a['x']+a['width']<=b['x']+1 or b['x']+b['width']<=a['x']+1 or a['y']+a['height']<=b['y']+1 or b['y']+b['height']<=a['y']+1;checks.append(f'{width}px: approval actions remain distinct and touch controls meet the compact-layout target')
  page.evaluate("window.__activitySeed('running')");item=page.locator('[data-tool-id=delegate] .activity-item-details > summary');(item.tap if touch else item.click)();expect(page.locator('.delegate-answer')).to_be_visible();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');checks.append(f'{width}px: live child disclosures open with real pointer or tap input and fit their column')
  page.evaluate("window.__activitySeed('complete');window.__activityView({reasoning:'collapsed'})");page.locator('.activity-strip > summary').click();page.locator('[data-tool-id=delegate] .activity-item-details > summary').click();page.locator('#transcript').evaluate('e=>e.scrollTop=0');page.wait_for_timeout(120)
  if width in [390,820,1280]:page.screenshot(path=str(root/'docs'/f'activity-{width}.png'))
  context.close()
 # The workspace agent (docs/WORKSPACE-AGENT.md): off by default, turned on in Advanced, its folder chosen natively (a
 # synthetic path in the preview), its calls drawn by kind; the offline preview never applies or runs anything.
 context=browser.new_context(viewport={'width':1280,'height':900});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html)
 page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#agent-settings')).to_be_visible();expect(page.locator('#agent-mode')).not_to_be_checked()
 page.locator('#agent-mode').check();page.locator('#apply-settings').click();assert page.locator('.composer [data-action=agent-folder]').count()==0
 current,made_in=page.locator('#agent-folder-current'),page.locator('#agent-root-current')
 expect(current).to_contain_text('None yet');expect(current).to_have_class(re.compile(r'\bunset\b'));expect(made_in).to_have_text('Not chosen');expect(page.locator('#agent-folder-new')).to_be_hidden()
 page.locator('#inspector [data-action=inspector]').click();page.locator('#prompt').fill('workspace agent demo');page.locator('#send').click();expect(page.locator('#toast')).to_contain_text('Choose where the workspace agent keeps new work')
 checks.append('the workspace agent is off by default and turned on in Advanced, with no folder button on the message box; with neither a folder nor a place for new ones, sending says where to choose')
 page.locator('.toolbar [data-action=inspector]').click();page.locator('[data-action=agent-root]').click();expect(made_in).to_have_text('C:\\Preview\\Tinfoil');expect(current).to_have_text('A new folder in C:\\Preview\\Tinfoil, made when you send')
 page.locator('[data-action=agent-folder]').click();expect(current).to_have_text('C:\\Preview\\example-project');expect(page.locator('#agent-folder-new')).to_be_visible()
 page.locator('#agent-folder-new').click();expect(current).to_have_text('A new folder in C:\\Preview\\Tinfoil, made when you send');expect(page.locator('#agent-folder-new')).to_be_hidden()
 checks.append('Advanced shows the conversation\'s folder and where new ones are made, both chosen natively; a project folder can be chosen, and dropped for a new folder')
 page.locator('#inspector [data-action=inspector]').click();expect(page.locator('#prompt')).to_have_value('workspace agent demo');page.locator('#send').click()
 row=page.locator('.reply .activity-strip');expect(row.locator('> summary .tick:not(.tick-out)')).to_contain_text('List files',timeout=8000);expect(row.locator('> summary .tick-out')).to_contain_text('Plan')
 expect(row.locator('> summary .tick:not(.tick-out)')).to_contain_text('npm test',timeout=8000);expect(row.locator('> summary .tick-out')).to_contain_text('Read file');assert page.locator('.reply .activity-strip').count()==1
 checks.append('as the agent works, each call rolls into one row in turn: the running call with its path or command, the one before it rolling out')
 edit=page.locator('.tool-run[data-state=awaiting_approval]').filter(has_text='Edit file');expect(edit).to_be_visible(timeout=8000)
 expect(edit.locator('.agent-subject')).to_have_text('src/sum.js');expect(edit.locator('.agent-diff .del')).to_have_text('-  return values.reduce((a, b) => a + b);');expect(edit.locator('.agent-diff .add')).to_have_text('+  return values.reduce((a, b) => a + b, 0);')
 expect(edit.locator('[data-action=approve-tool]')).to_have_text('Review & apply…')
 command=page.locator('.tool-run[data-state=awaiting_approval]').filter(has_text='Command');expect(command.locator('.agent-command')).to_have_text("Get-Content -LiteralPath 'C:\\Users\\Preview\\Downloads\\notes.md'")
 expect(command.locator('.agent-outside')).to_have_text('Outside the folder: this command names C:\\Users\\Preview\\Downloads\\notes.md.');expect(edit.locator('.agent-outside')).to_have_count(0)
 expect(command.locator('.agent-where')).to_contain_text('Windows PowerShell 5.1');expect(command.locator('.approval-warning')).to_contain_text('not in a sandbox');expect(command.locator('[data-action=approve-tool]')).to_have_text('Review & run once…')
 expect(page.locator('.response-activity')).to_contain_text('Approval needed · step 2 of 30')
 plan=page.locator('.agent-plan-current li');expect(plan).to_have_count(3);assert [plan.nth(i).get_attribute('data-status') for i in range(3)]==['completed','in_progress','pending']
 checks.append('agent calls are drawn by kind: a change as a coloured diff, a command with its folder and shell and the paths outside the folder it names, the current plan above them, and the step count in the status line')
 expect(row.locator('> summary .tick:not(.tick-out)')).to_contain_text('Edit file src/sum.js');expect(row.locator('.activity-count')).to_have_text('6 tool runs')
 row.locator('> summary').click();finished=page.locator('.tool-run[data-state=complete]');expect(finished).to_have_count(4)
 expect(finished.filter(has_text='Read file').locator('.agent-subject')).to_have_text('src/sum.js')
 failed=finished.filter(has_text='npm test');assert failed.locator('[data-activity-body]').inner_html()=='';failed.locator('.activity-item-details > summary').click()
 expect(failed.locator('.tool-stdout')).to_contain_text('TypeError');expect(failed.locator('.tool-metadata')).to_contain_text('exit 1')
 edit.locator('[data-action=approve-tool]').click();expect(page.locator('#toast')).to_contain_text('does not execute Python, run commands, change files')
 checks.append('finished agent calls keep their results in the history, and the offline preview refuses to apply or run anything')
 made=re.compile(r'^C:\\Preview\\Tinfoil\\\d{4}-\d{2}-\d{2} workspace agent demo [0-9a-f]{4}$');expect(command.locator('.agent-where')).to_contain_text('C:\\Preview\\Tinfoil\\')
 page.locator('.toolbar [data-action=inspector]').click();expect(current).to_have_text(made);expect(page.locator('#agent-folder-new')).to_be_visible();page.locator('#inspector [data-action=inspector]').click()
 checks.append('sending without a folder gives the conversation a new one, named after the date and its first message, under the chosen place')
 page.screenshot(path=str(root/'docs'/'agent-1280.png'));context.close()
 assert not errors,errors;assert not [u for u in requests if u.startswith(('http:','https:'))],requests;checks.append('activity checks produced no unhandled JavaScript errors or external requests')
 browser.close()
report={'checks':len(checks),'passed':checks,'javascript_errors':errors,'scope':'Linux Chromium with synthetic snapshots; emulated touch; no live MCP, sub-agent, API billing or native approval execution.'}
(root/'docs/ui-activity-checks.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
