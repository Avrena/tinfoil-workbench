"""Chart hover, keyboard reading, stacked bars and pie charts in the production renderer, with synthetic charts.
No live inference or network."""
import argparse, json, re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);args=p.parse_args()
root=Path(__file__).resolve().parents[1];html=(root/'preview/index.html').read_text(encoding='utf-8');checks=[];errors=[];requests=[]
marker='const pause = ms => new Promise(r => setTimeout(r, ms));'
fixture='''
window.__charts=()=>{
  const reply=workspace.threads.find(t=>t.id===workspace.activeId).turns[0].replies[0];
  const specs=[
    {title:'Energy mix',type:'bar',stacked:true,value_suffix:' GW',labels:['2024','2025 <b>est</b>'],series:[{name:'Solar',values:[2,3]},{name:'Wind',values:[1,1.5]}]},
    {title:'Traffic sources',type:'pie',labels:['Search','Direct','Social','Mail'],series:[{name:'Visits',values:[60,25,13,2]}]},
    {title:'Latency',type:'line',value_suffix:' ms',labels:['Mon','Tue','Wed','Thu'],series:[{name:'API',values:[40,52,null,47]},{name:'Web',values:[80,76,90,85]}]},
  ].map(s=>visual_tools_js_1.chartSpec(s));
  reply.content='Stacked.\\n\\nPie.\\n\\nLine.\\n\\n';
  reply.tools=specs.map((spec,i)=>previewTool('chart',JSON.stringify(spec),visual_tools_js_1.chartSVG(spec),spec.title,[0,10,16][i]));emit();
};
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
def check(label):checks.append(label)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html)
    page.locator('#prompt').fill('Show charts.');page.locator('#send').click();expect(page.locator('#stop')).to_be_hidden(timeout=15000)
    page.evaluate('window.__charts()');figures=page.locator('.inline-artifact');expect(figures).to_have_count(3)
    stacked,pie,line=figures.nth(0),figures.nth(1),figures.nth(2)

    # Line: the crosshair snaps to the nearest label and one readout lists every series there.
    canvas=line.locator('.visual-canvas');canvas.scroll_into_view_if_needed();svg=canvas.locator('svg').bounding_box()
    page.mouse.move(svg['x']+svg['width']*.36,svg['y']+svg['height']*.5)
    tip=line.locator('.chart-tooltip');expect(tip).to_be_visible();expect(tip.locator('.tip-head')).to_have_text('Tue')
    expect(tip.locator('.tip-row')).to_have_count(2);expect(tip).to_contain_text('52 ms');expect(tip).to_contain_text('76 ms')
    guide=line.locator('.chart-crosshair');expect(guide).to_be_visible();assert guide.evaluate('e=>e.offsetWidth')==1
    gx=guide.bounding_box()['x'];page.mouse.move(svg['x']+svg['width']*.62,svg['y']+svg['height']*.5);expect(tip.locator('.tip-head')).to_have_text('Wed')
    assert guide.bounding_box()['x']>gx+50;expect(tip.locator('.tip-row')).to_have_count(1)
    check('line: the crosshair snaps to the nearest label and one readout lists every series with a value there')
    line.locator('.chart-legend button').nth(1).click();expect(line.locator('.chart-legend button').nth(1)).to_have_attribute('aria-pressed','false')
    svg=canvas.locator('svg').bounding_box();page.mouse.move(svg['x']+svg['width']*.36,svg['y']+svg['height']*.5);expect(tip.locator('.tip-head')).to_have_text('Tue')
    expect(tip.locator('.tip-row')).to_have_count(1);expect(tip).not_to_contain_text('Web');line.locator('.chart-legend button').nth(1).click()
    page.mouse.move(svg['x']-40,svg['y']-40);expect(tip).to_be_hidden();expect(guide).to_be_hidden()
    check('a hidden series leaves the readout, and leaving the chart hides it')
    assert line.locator('.series-swatch.line').count()==2
    check('legend keys mirror the mark: strokes for a line chart')

    # Keyboard: the same readout from the arrow keys.
    canvas.focus();expect(canvas).to_be_focused()
    page.keyboard.press('ArrowRight');expect(tip.locator('.tip-head')).to_have_text('Mon')
    page.keyboard.press('ArrowRight');expect(tip.locator('.tip-head')).to_have_text('Tue')
    page.keyboard.press('End');expect(tip.locator('.tip-head')).to_have_text('Thu')
    page.keyboard.press('Home');expect(tip.locator('.tip-head')).to_have_text('Mon')
    assert tip.get_attribute('role')=='status' and tip.get_attribute('aria-live')=='polite'
    page.keyboard.press('Escape');expect(tip).to_be_hidden()
    check('keyboard: arrow keys, Home and End read the same values, announced politely; Escape hides them')

    # Stacked bars: the whole category band is the target; the readout adds the total.
    canvas=stacked.locator('.visual-canvas');canvas.scroll_into_view_if_needed();svg=canvas.locator('svg').bounding_box()
    page.mouse.move(svg['x']+svg['width']*.72,svg['y']+svg['height']*.2)
    tip=stacked.locator('.chart-tooltip');expect(tip).to_be_visible()
    expect(tip.locator('.tip-head')).to_have_text('2025 <b>est</b>');assert tip.locator('b').count()==0
    expect(tip).to_contain_text('3 GW');expect(tip).to_contain_text('1.5 GW');expect(tip).to_contain_text('4.5 GW');expect(tip).to_contain_text('Total')
    band=stacked.locator('.chart-crosshair');expect(band).to_have_class(re.compile(r'\bband\b'));assert band.bounding_box()['width']>100
    check('stacked bars: the category band is the hover target and the readout adds the total')
    check('labels from the model are shown as text, never HTML')
    marks=stacked.locator('svg .chart-mark');assert marks.count()==4
    assert stacked.locator('svg title').count()==1,'the inline chart has no per-mark native tooltips'
    check('stacked bars draw one segment per value; native mark tooltips give way to the hover layer')

    # Pie: parts are listed with their shares, the slice under the pointer is read, and the table adds shares.
    canvas=pie.locator('.visual-canvas');canvas.scroll_into_view_if_needed()
    assert pie.locator('.chart-legend button').count()==0;expect(pie.locator('.legend-item')).to_have_count(4)
    expect(pie.locator('.legend-item').first).to_contain_text('Search');expect(pie.locator('.legend-share').first).to_have_text('60%')
    slice_=pie.locator('svg [data-key=slice-0]').bounding_box();page.mouse.move(slice_['x']+slice_['width']*.75,slice_['y']+slice_['height']*.5)
    tip=pie.locator('.chart-tooltip');expect(tip).to_be_visible();expect(tip.locator('.tip-head')).to_have_text('Search');expect(tip).to_contain_text('60% of 100')
    expect(pie.locator('.chart-crosshair')).to_be_hidden()
    page.screenshot(path=str(root/'docs/chart-pie.png'),clip=pie.bounding_box())
    pie.locator('[data-inline-tab=data]').click();expect(pie.locator('thead')).to_contain_text('Share');expect(pie.locator('tbody tr').first).to_contain_text('60%')
    pie.locator('[data-inline-tab=preview]').click()
    check('pie: parts are listed with their shares, the slice under the pointer is read, and the data table adds shares')

    stacked.scroll_into_view_if_needed();page.mouse.move(svg['x']+svg['width']*.3,svg['y']+svg['height']*.3)
    page.screenshot(path=str(root/'docs/chart-hover.png'),clip=stacked.bounding_box())
    assert not errors,errors
    external=[u for u in requests if not u.startswith(('data:','blob:','about:'))];assert not external,external
    check('no JavaScript errors or external requests')
    browser.close()
out={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'scope':'Production renderer on Chromium with synthetic charts; no model, account or network.'}
(root/'docs/ui-charts-checks.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
