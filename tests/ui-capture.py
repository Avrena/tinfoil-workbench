"""Capture actual production-renderer states from the labelled offline showcase."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--chromium',default=None);parser.add_argument('--no-sandbox',action='store_true');args=parser.parse_args();root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox'] if args.no_sandbox else [])
 page=b.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content((root/'preview/index.html').read_text(encoding='utf-8'));page.locator('#prompt').fill('Show an inline visualization demo.');page.locator('#send').click()
 expect(page.locator('.is-thinking')).to_be_visible();page.screenshot(path=str(root/'docs/thinking.png'))
 expect(page.locator('#stop')).to_be_hidden(timeout=15000);expect(page.locator('.inline-artifact')).to_have_count(2)
 page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(600);page.mouse.move(100,40);page.screenshot(path=str(root/'docs/preview.png'))
 page.locator('.inline-artifact').first.locator('.inline-expand').click();expect(page.locator('#artifact-panel')).to_be_visible();page.wait_for_timeout(650);page.mouse.move(100,40);page.screenshot(path=str(root/'docs/preview-workspace.png'));page.locator('[data-panel=close]').click()
 page.set_viewport_size({'width':980,'height':860});page.locator('#transcript').evaluate('(e)=>e.scrollTop=0');page.wait_for_timeout(100);page.screenshot(path=str(root/'docs/preview-compact.png'))
 assert not errors,errors;b.close()
print('Saved four actual-renderer screenshots; synthetic demo values.')
