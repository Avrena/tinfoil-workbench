"""Chart hover, keyboard reading, stacked bars, pie charts, centred bars, timelines and stat cards in the production
renderer, with synthetic data. No live inference or network."""
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
    {title:'Revenue',type:'bar',value_prefix:'$',value_suffix:'B',labels:['2023','2024','2025','2026'],series:[{name:'Reported',values:[0.2,1,4.5,null]},{name:'Projection',values:[null,null,null,15]}]},
  ].map(s=>visual_tools_js_1.chartSpec(s));
  const timeline=visual_tools_js_1.timelineSpec({title:'Release history',description:'Synthetic preview data',events:[{date:'2023',title:'Private beta'},{date:'Mar 2025',title:'General release <b>1.0</b>',description:'Available in every region.'},{date:'Q3 2026',title:'Version 2',description:'Planned.',tentative:true}]});
  const stats=visual_tools_js_1.statsSpec({title:'Quarter at a glance',description:'Synthetic preview data',stats:[{label:'Revenue',value:'$4.2B',delta:'+12% vs Q2',trend:'up',good:true,sparkline:[3.1,3.4,3.8,4.2]},{label:'Churn',value:'2.1%',delta:'+0.3 pt vs Q2',trend:'up',good:false},{label:'Active users',value:1284000,trend:'flat'}]});
  reply.content='Stacked.\\n\\nPie.\\n\\nLine.\\n\\nSplit.\\n\\nTimeline.\\n\\nStats.\\n\\n';
  reply.tools=specs.map((spec,i)=>previewTool('chart',JSON.stringify(spec),visual_tools_js_1.chartSVG(spec),spec.title,[0,10,16,23][i]));
  const widget=(kind,name,spec,html,offset)=>{const t=previewTool(kind,JSON.stringify(spec),html,spec.title,offset,'text/html');t.name=name;t.artifacts[0].name=spec.title+'.html';return t;};
  reply.tools.push(widget('timeline','render_timeline',timeline,visual_tools_js_1.timelineHTML(timeline),31),widget('stats','render_stat_cards',stats,visual_tools_js_1.statsHTML(stats),42));emit();
};
'''
assert marker in html;html=html.replace(marker,marker+fixture,1)
def check(label):checks.append(label)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':1100});page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(html)
    page.locator('#prompt').fill('Show charts.');page.locator('#send').click();expect(page.locator('#stop')).to_be_hidden(timeout=15000)
    page.evaluate('window.__charts()');figures=page.locator('.inline-artifact');expect(figures).to_have_count(6)
    stacked,pie,line,split,timeline,stats=(figures.nth(i) for i in range(6))
    # Figures mount as they near the view; mount all of them first so later ones cannot shift the page under the pointer.
    for i in range(6):figures.nth(i).scroll_into_view_if_needed()
    expect(page.locator('.inline-artifact-stage[aria-busy=false]')).to_have_count(6)

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

    # Series that never share a label: every bar is whole and centred on its label.
    split.scroll_into_view_if_needed();marks=split.locator('svg .chart-mark');expect(marks).to_have_count(4)
    labels={t.text_content():t.bounding_box() for t in split.locator('svg text[text-anchor=middle]').all()}
    widths=[]
    for i,year in enumerate(['2023','2024','2025','2026']):
        bar,label=marks.nth(i).bounding_box(),labels[year];widths.append(round(bar['width'],1))
        assert abs((bar['x']+bar['width']/2)-(label['x']+label['width']/2))<2,(year,bar,label)
    assert len(set(widths))==1,widths
    check('series that never share a label are drawn as whole bars centred on their labels')

    # Timeline: dated events in order, a tentative one marked in words, model text as text, and a Data view.
    timeline.scroll_into_view_if_needed();items=timeline.locator('.wb-timeline li');expect(items).to_have_count(3)
    expect(items.nth(0).locator('.when')).to_have_text('2023');expect(items.nth(1).locator('strong')).to_have_text('General release <b>1.0</b>')
    assert timeline.locator('.wb-timeline b').count()==0
    expect(items.nth(2)).to_have_class(re.compile(r'\btentative\b'));expect(items.nth(2).locator('.tentative-tag')).to_have_text('Tentative')
    assert timeline.locator('.inline-interact').is_hidden(),'a timeline has no scripts to enable'
    timeline.locator('[data-inline-tab=data]').click();expect(timeline.locator('thead')).to_contain_text('Status');expect(timeline.locator('tbody tr')).to_have_count(3)
    expect(timeline.locator('tbody tr').nth(2)).to_contain_text('Tentative');timeline.locator('[data-inline-tab=preview]').click()
    check('timeline: events in order, a tentative event marked in words, model text shown as text, and a Data view')

    # Stat cards: value, change with arrow and words, colour only where the model judged the change.
    stats.scroll_into_view_if_needed();cards=stats.locator('.wb-stats li');expect(cards).to_have_count(3)
    expect(cards.nth(0).locator('.stat-value')).to_have_text('$4.2B');expect(cards.nth(2).locator('.stat-value')).to_have_text('1.3M')
    assert cards.nth(0).locator('.stat-arrow').evaluate('e=>getComputedStyle(e).color')=='rgb(12, 163, 12)'
    assert cards.nth(1).locator('.stat-arrow').evaluate('e=>getComputedStyle(e).color')=='rgb(208, 59, 59)'
    expect(cards.nth(1).locator('.sr-only')).to_have_text('Up, bad: ');expect(cards.nth(2).locator('.sr-only')).to_have_text('Unchanged: ')
    assert cards.nth(0).locator('svg.stat-spark').count()==1 and cards.nth(1).locator('svg.stat-spark').count()==0
    boxes=[cards.nth(i).bounding_box() for i in range(3)];assert abs(boxes[0]['y']-boxes[2]['y'])<1,'three cards fit one row at this width'
    stats.locator('[data-inline-tab=data]').click();expect(stats.locator('thead')).to_contain_text('Recent values');expect(stats.locator('tbody tr').first).to_contain_text('3.1, 3.4, 3.8, 4.2')
    stats.locator('[data-inline-tab=preview]').click()
    check('stat cards: values, a change told by arrow and words, colour only for a judged change, and a Data view')
    box=timeline.bounding_box();end=stats.bounding_box();page.screenshot(path=str(root/'docs/widgets.png'),clip={'x':box['x'],'y':box['y'],'width':box['width'],'height':end['y']+end['height']-box['y']})
    split.scroll_into_view_if_needed();page.screenshot(path=str(root/'docs/chart-split.png'),clip=split.bounding_box())

    stacked.scroll_into_view_if_needed();svg=stacked.locator('.visual-canvas svg').bounding_box();page.mouse.move(svg['x']+svg['width']*.3,svg['y']+svg['height']*.3)
    page.screenshot(path=str(root/'docs/chart-hover.png'),clip=stacked.bounding_box())
    assert not errors,errors
    external=[u for u in requests if not u.startswith(('data:','blob:','about:'))];assert not external,external
    check('no JavaScript errors or external requests')
    browser.close()
out={'checks':len(checks),'passed':checks,'javascript_errors':errors,'external_requests':[],'scope':'Production renderer on Chromium with synthetic charts, a timeline and stat cards; no model, account or network.'}
(root/'docs/ui-charts-checks.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
