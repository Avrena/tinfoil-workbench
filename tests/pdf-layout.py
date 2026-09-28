"""Print-layout smoke using production printableDocument and headless Chromium.
Not a test of Electron renderPDF or PDF.js; those are tested by smoke:desktop.
"""
import argparse,json,subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
import fitz
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);parser.add_argument('--no-sandbox',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
js="""import {printableDocument} from './dist/core/pdf-document.js';
import {chartSpec,chartSVG,tableSpec,tableHTML} from './dist/core/visual-tools.js';
const chart=chartSVG(chartSpec({title:'Synthetic repair observations',type:'bar',labels:['Round 1','Round 2','Round 3'],y_label:'Seconds',series:[{name:'Observed sample',values:[142,180,218]}]}),[],{print:true});
const table=tableHTML(tableSpec({title:'Underlying synthetic data',columns:['Round','Seconds'],rows:[[1,142],[2,180],[3,218]]}));
console.log(printableDocument('<h1>Artifact print-layout check</h1><p>Workbench __VERSION__ - synthetic fixture, not a live model response.</p>'+chart+table+'<p>This file checks the shared print stylesheet through headless Chromium. It does not establish that Electron printing or PDF.js works on Windows.</p><script>document.body.textContent=\"SCRIPT RAN\"</script>'));
"""
js=js.replace('__VERSION__',json.loads((root/'package.json').read_text())['version'])
html=subprocess.check_output(['node','--input-type=module','-e',js],cwd=root,text=True)
with sync_playwright() as p:
 options={'headless':True}
 if args.chromium:options['executable_path']=args.chromium
 if args.no_sandbox:options['args']=['--no-sandbox']
 browser=p.chromium.launch(**options);page=browser.new_page(java_script_enabled=False);requests=[];page.on('request',lambda r:requests.append(r.url));page.set_content(html);page.pdf(path=str(root/'docs/pdf-layout-smoke.pdf'),format='A4',print_background=True,prefer_css_page_size=True);browser.close()
pdf=fitz.open(root/'docs/pdf-layout-smoke.pdf');assert len(pdf)==1;alltext=''.join(p.get_text() for p in pdf);assert 'SCRIPT RAN' not in alltext;assert '218' in alltext and 'Underlying synthetic data' in alltext
pdf[0].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(root/'docs/pdf-layout-smoke.png');assert not requests
result={'pages':len(pdf),'checks':['one A4 page','expected text and tabular values extracted','embedded script did not replace content','no network requests'],'scope':'shared print stylesheet + headless Chromium only; not native Electron printing or real PDF.js'}
(root/'docs/pdf-layout-checks.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
