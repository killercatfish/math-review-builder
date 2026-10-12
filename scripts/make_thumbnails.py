"""Render preview thumbnails of the example kit for the landing page.

Writes examples/thumb-walkthrough.jpg and examples/thumb-sheet.jpg from docs/example.html.
scripts/build.py inlines them, so rerun build.py afterwards. Needs Playwright and Pillow.
"""
import asyncio, os, tempfile
from playwright.async_api import async_playwright
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMPLE = 'file://' + os.path.join(ROOT, 'docs', 'example.html')
OUT = os.path.join(ROOT, 'examples')
WIDTH = 560

def save_jpeg(img, name):
    img = img.convert('RGB')
    img = img.resize((WIDTH, round(img.height * WIDTH / img.width)), Image.LANCZOS)
    path = os.path.join(OUT, name)
    img.save(path, 'JPEG', quality=82, optimize=True, progressive=True)
    print(f'{os.path.relpath(path, ROOT)}  {img.width}x{img.height}  {os.path.getsize(path)//1024} KB')

async def main():
    with tempfile.TemporaryDirectory() as tmp:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={'width': 760, 'height': 900}, device_scale_factor=2, color_scheme='light')
            await pg.goto(EXAMPLE); await pg.wait_for_timeout(500)
            # A walkthrough mid-way through a missed question, on a frame with a yellow highlight.
            await pg.evaluate('''() => {
              const chips=[...document.querySelectorAll('#test-chips .chip')];
              chips.find(c=>c.textContent==='#14').click();
              const d=document.querySelector('#test-panel details'); if(d) d.remove();
              document.querySelectorAll('#test-panel .dot')[2].click();
            }''')
            await pg.wait_for_timeout(500)
            shot = os.path.join(tmp, 'walk.png')
            await pg.locator('#test-panel .panel').screenshot(path=shot)
            save_jpeg(Image.open(shot), 'thumb-walkthrough.jpg')
            # First page of the printable practice sheet, rendered by the browser in print mode at letter width.
            sheet = await b.new_page(viewport={'width': 720, 'height': 560}, device_scale_factor=2, color_scheme='light')
            await sheet.goto(EXAMPLE); await sheet.wait_for_timeout(500)
            await sheet.emulate_media(media='print')
            await sheet.add_style_tag(content='body{padding:24px 28px!important;background:#fff}')
            shot = os.path.join(tmp, 'sheet.png')
            await sheet.screenshot(path=shot)
            save_jpeg(Image.open(shot), 'thumb-sheet.jpg')
            await b.close()

asyncio.run(main())
