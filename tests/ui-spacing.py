"""Spacing/geometry regression against the real renderer with in-memory fixtures.
No native desktop, live inference, physical device or actual keyboard claim.
"""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--chromium', default=None)
parser.add_argument('--no-sandbox', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
checks, errors, matrix = [], [], []
marker = 'const pause = ms => new Promise(r => setTimeout(r, ms));'
fixture = r'''window.__spacingSeed=()=>{
 const {chartSpec,chartSVG,tableSpec,tableHTML}=require('/core/visual-tools.js');
 const t=workspace.threads.find(t=>t.id===workspace.activeId);
 workspace.projects=[{id:'spacing-project',name:'Workbench design',createdAt:1}];t.projectId='spacing-project';t.title='Repair measurements and revised timing';
 const intro='The revised configuration is faster in these six **synthetic sample runs**. Both series use the same scale.\n\n';
 const middle='\n\nThe largest gap is in run 6. Use Data to inspect the values. This preview is not a measured performance claim.\n\n';
 const spec=chartSpec({title:'Response time',description:'Synthetic example values.',type:'line',labels:['Run 1','Run 2','Run 3','Run 4','Run 5','Run 6'],y_label:'Milliseconds',series:[{name:'Baseline',values:[48,62,56,79,70,94]},{name:'Revised',values:[36,43,39,51,48,61]}]});
 const table=tableSpec({title:'Measurement details',columns:['Measurement','Baseline','Revised','Description'],rows:[['Long measurement label for a narrow table',48,36,'Synthetic local fixture'],['Measurement two',62,43,'Synthetic local fixture']]});
 t.turns=[{id:'spacing-turn',prompt:'Compare the measurements, then show the underlying data.',attachments:[],createdAt:1,selectedReplyId:'spacing-reply',replies:[{id:'spacing-reply',model:'demo/writer',content:intro+middle+'\n\nKeep figures close to the explanation, with transparent surfaces.\n\n```python\nvalues = [48, 62, 56, 79, 70, 94]\nprint(sum(values) / len(values))\n```',reasoning:'Synthetic returned reasoning. Keep observations separate from assumptions.',systemPromptName:'Release notes reviewer',status:'complete',finishReason:'stop',error:null,usage:null,elapsedMs:1200,tools:[previewTool('chart',JSON.stringify(spec),chartSVG(spec),'Response time',intro.length),previewTool('table',JSON.stringify(table),tableHTML(table),'Measurement details',intro.length+middle.length,'text/html')],toolMessages:[]}]}];emit();
};
window.__spacingResetControls=()=>{const t=workspace.threads.find(t=>t.id===workspace.activeId);t.settings.model='demo/writer';t.settings.toolsMode='off';emit();};
window.__spacingBusy=value=>{const t=workspace.threads.find(t=>t.id===workspace.activeId);t.settings.model='deepseek-v4-pro';t.settings.toolsMode='ask';t.settings.systemPrompt=value?'Keep release notes brief.':'';t.settings.systemPromptName=value?'Release notes reviewer':'';busy=value?t.id:null;t.turns[0].replies[0].status=value?'streaming':'complete';t.turns[0].replies[0].phase=value?'thinking':'answering';emit();};
'''
html = (root/'preview/index.html').read_text(encoding='utf-8')
assert marker in html
html = html.replace(marker, marker + fixture, 1)

def rect(page, selector):
    return page.locator(selector).first.bounding_box()

def inside(child, parent, tolerance=1):
    return (child['x'] >= parent['x'] - tolerance and child['y'] >= parent['y'] - tolerance
            and child['x'] + child['width'] <= parent['x'] + parent['width'] + tolerance
            and child['y'] + child['height'] <= parent['y'] + parent['height'] + tolerance)

def no_overlap(page, selector):
    return page.locator(selector).evaluate_all('''elements=>{
      const boxes=elements.filter(e=>e.getClientRects().length&&!e.closest('[hidden],.hidden')).map(e=>({r:e.getBoundingClientRect(),label:e.getAttribute('aria-label')||e.textContent}));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
        const a=boxes[i].r,b=boxes[j].r;
        if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)return [boxes[i].label,boxes[j].label];
      }return null;
    }''')

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True,
                               args=['--no-sandbox'] if args.no_sandbox else [])
    sizes = [('desktop',1440,1000,False),('laptop',1280,800,False),('tablet',820,1180,True),
             ('tablet-small',768,1024,True),('tablet-landscape',1024,768,True),
             ('phone',390,844,True),('phone-small',320,740,True),('phone-360',360,800,True),
             ('phone-large',430,932,True)]
    for name,width,height,touch in sizes:
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch,device_scale_factor=1)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html);page.evaluate('window.__spacingSeed()')
        expect(page.locator('.inline-artifact')).to_have_count(2)
        page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(180)
        column,composer=rect(page,'.transcript-inner'),rect(page,'.composer')
        assert abs(column['x']-composer['x'])<=1 and abs(column['width']-composer['width'])<=1,(name,column,composer)
        assert column['width']<=801
        checks.append(f'{name}: transcript and composer share exact left/right edges and a bounded reading width')
        assert not no_overlap(page,'.toolbar > .icon-button,.toolbar > .thread-heading,.toolbar > .export-menu')
        assert rect(page,'.toolbar')['height']<=72
        checks.append(f'{name}: breadcrumb/title and toolbar actions fit without overlap or inflated header height')
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert rect(page,'#prompt')['height']<=50
        assert composer['height']<=110
        checks.append(f'{name}: empty composer remains compact without introducing page overflow')
        # A single answer has no header row; it starts with its reasoning and answer.
        assert page.locator('.reply > .message-label').count()==0
        user,start=rect(page,'.user-row'),rect(page,'.reply-context')
        assert 12<=start['y']-(user['y']+user['height'])<=24,(name,user,start)
        context_box,body=rect(page,'.reply-context'),rect(page,'.reply-content')
        assert 8<=body['y']-(context_box['y']+context_box['height'])<=16
        checks.append(f'{name}: answer start, reasoning and answer use bounded vertical group spacing')
        content,footer=rect(page,'.reply-content'),rect(page,'.reply-footer')
        assert 8<=footer['y']-(content['y']+content['height'])<=16,(name,content,footer)
        expect(page.locator('.reply-signature')).to_contain_text('demo/writer');expect(page.locator('.signature-instructions')).to_contain_text('Release notes reviewer')
        assert inside(rect(page,'.reply-signature'),rect(page,'.transcript-inner'))
        assert not no_overlap(page,'.reply-footer .reply-actions > button,.reply-signature')
        checks.append(f'{name}: reply footer keeps actions and the model/instructions signature apart inside the reading column')
        fig=page.locator('.inline-artifact').first
        assert fig.evaluate('e=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
        assert fig.evaluate('e=>getComputedStyle(e).borderTopWidth')=='0px'
        assert not no_overlap(page,'.inline-artifact:first-of-type .inline-tabs button,.inline-artifact:first-of-type .inline-fold,.inline-artifact:first-of-type .inline-expand')
        checks.append(f'{name}: visualization controls do not overlap and figures stay seamless')
        page.locator('#prompt').fill('\n'.join('A longer editable draft line.' for _ in range(9)))
        page.wait_for_timeout(200)
        page.locator('#transcript').evaluate('(e)=>{e.scrollTop=0;e.dispatchEvent(new Event("scroll"));}')
        expect(page.locator('#jump')).to_be_visible()
        jump,region=rect(page,'#jump'),rect(page,'.composer-region')
        assert 8<=region['y']-(jump['y']+jump['height'])<=16,(name,jump,region)
        assert rect(page,'#prompt')['height']>50
        checks.append(f'{name}: multiline draft grows and Latest stays above the measured composer height')
        page.evaluate('window.__spacingBusy(true)');expect(page.locator('#quick-effort')).to_be_visible();expect(page.locator('#stop')).to_be_visible();page.wait_for_timeout(180)
        bounds=rect(page,'.composer')
        expect(page.locator('#composer-instructions')).to_have_class('instructions-chip is-set')
        for control in ['#composer-model','#quick-effort','#composer-instructions','#stop','#send']:
            assert inside(rect(page,control),bounds),(name,control,rect(page,control),bounds)
        assert not no_overlap(page,'.composer-tools > button,.composer-tools > select')
        checks.append(f'{name}: effort, model, instructions, Stop and Send remain inside the composer without collisions')
        page.evaluate('window.__spacingBusy(false)');page.locator('#prompt').fill('');page.wait_for_timeout(180)
        page.locator('[data-action=edit-reply]').click();expect(page.locator('#edit-dialog')).to_be_visible()
        box=rect(page,'#edit-dialog');save=rect(page,'#editor-save');field=rect(page,'#editor-content')
        assert inside(save,box) and inside(field,box)
        assert not no_overlap(page,'.editor-modes button,.editor-format button')
        assert not no_overlap(page,'.editor-footer > div')
        for selector in ['.editor-fields','.editor-toolbar','.editor-body','.editor-footer']:
            pad=page.locator(selector).evaluate('e=>parseFloat(getComputedStyle(e).paddingLeft)')
            assert pad==(16 if width<=600 else 24),(name,selector,pad)
        checks.append(f'{name}: editor header, tabs, field and footer use a shared inset with reachable Save')
        if name in ['desktop','phone','tablet']:
            page.locator('#editor-content').fill('A revised answer with **consistent spacing**.\n\n$$x = 180$$\n\nSource text remains editable.');page.wait_for_timeout(160)
            page.screenshot(path=str(root/f'docs/editor-{name}.png'))
            page.locator('[data-editor-field=reasoning]').click();page.wait_for_timeout(80)
            if name=='tablet':page.screenshot(path=str(root/'docs/editor-thinking.png'))
        page.keyboard.press('Escape')
        if page.locator('.editor-discard').is_visible():page.locator('[data-editor=discard]').click()
        expect(page.locator('#edit-dialog')).to_be_hidden()
        page.locator('.inline-artifact').first.locator('.inline-expand').click();expect(page.locator('#artifact-panel')).to_be_visible()
        assert not no_overlap(page,'.artifact-panel-tools .artifact-tabs,.artifact-panel-tools > button')
        assert page.locator('#artifact-panel').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        checks.append(f'{name}: artifact workspace tool groups wrap instead of colliding')
        page.locator('[data-panel=close]').click()
        # Settings use the same content inset and do not spill at narrow widths.
        page.locator('.toolbar [data-action=inspector]').click();expect(page.locator('#inspector')).to_be_visible()
        assert page.locator('.inspector-body').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
        heading=page.locator('.field-heading').evaluate('e=>[getComputedStyle(e).marginTop,getComputedStyle(e.querySelector("label")).marginTop,getComputedStyle(e.querySelector("label")).marginBottom]')
        assert heading==['16px','0px','0px'],(name,heading)
        checks.append(f'{name}: advanced fields keep their inset without sideways overflow, and the instructions heading adds no extra margin')
        page.locator('#inspector [data-action=inspector]').click();page.wait_for_timeout(220)
        assert page.evaluate('scrollY===0&&document.scrollingElement.scrollTop===0&&document.querySelector("#app").scrollTop===0'),(name,page.evaluate('({scroll:scrollY,top:document.querySelector("#app").getBoundingClientRect().top})'))
        checks.append(f'{name}: closing editors and drawers does not scroll the app shell out of view')
        if name in ['desktop','phone','tablet']:
            page.evaluate('window.__spacingResetControls()');page.wait_for_timeout(120)
            page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(200);page.mouse.move(0,0)
            page.screenshot(path=str(root/f'docs/preview-{name}.png'))
        matrix.append({'name':name,'width':width,'height':height,'touch':touch,'reading_width':round(column['width'],2),'column_alignment_error':round(abs(column['x']-composer['x']),3),'idle_composer_height':composer['height']})
        context.close()
    # A split view is narrower than the window. Its visualization header must
    # respond to its own container, not only a viewport media query.
    page=browser.new_page(viewport={'width':1440,'height':1000});page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html);page.evaluate('window.__spacingSeed()')
    page.locator('.inline-expand').first.click();page.wait_for_timeout(250)
    fig=page.locator('.inline-artifact').first
    assert fig.bounding_box()['width']<560
    assert fig.locator('.inline-artifact-header').evaluate('e=>getComputedStyle(e).display')=='grid'
    assert not no_overlap(page,'.inline-artifact:first-of-type .inline-tabs button,.inline-artifact:first-of-type .inline-fold,.inline-artifact:first-of-type .inline-expand')
    checks.append('desktop split workspace: inline controls reflow based on figure width, not viewport width')
    page.screenshot(path=str(root/'docs/preview-workspace.png'));page.close()
    # Simulated keyboard occupation, not a hardware/on-screen-keyboard test.
    context=browser.new_context(viewport={'width':390,'height':420},has_touch=True,is_mobile=True)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_content(html);page.evaluate('window.__spacingSeed()')
    page.locator('#prompt').fill('A draft retained during keyboard-height simulation.');page.locator('[data-action=edit-draft]').tap()
    assert rect(page,'#editor-content')['height']>=60
    assert rect(page,'#editor-save')['y']+rect(page,'#editor-save')['height']<=420
    checks.append('reduced phone height: editor keeps at least 60px of writable area with visible Save')
    page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(150)
    assert rect(page,'#editor-content')['height']>=60
    assert rect(page,'#editor-save')['y']+rect(page,'#editor-save')['height']<=390
    checks.append('landscape rotation: compact editor spacing preserves writable area and actions')
    context.close()
    assert not errors,errors
    checks.append('no unhandled JavaScript or ResizeObserver-loop errors in the spacing matrix')
    browser.close()
result={'checks':len(checks),'passed':checks,'matrix':matrix,'javascript_errors':errors,'scope':'Linux Chromium geometry/touch emulation and synthetic fixtures only; no physical devices, real keyboards, Windows native integration or live inference'}
(root/'docs/ui-spacing-checks.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
