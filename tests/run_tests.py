"""End-to-end checks for the built pages in docs/.

Run `python3 scripts/build.py` first. Needs Playwright (pip install playwright; playwright install chromium) and Pillow.
Uses only the fictional example kit. Nothing here touches a real AI.
"""
import asyncio, json, os, subprocess, sys
from playwright.async_api import async_playwright
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'out'); os.makedirs(OUT, exist_ok=True)
DOCS = 'file://' + os.path.join(ROOT, 'docs')
KIT = json.load(open(os.path.join(ROOT, 'examples', 'example-kit.json')))
failures = []

def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + (f'  ({detail})' if detail and not cond else ''))
    if not cond: failures.append(name)

def fixture_photos():
    paths = []
    for i in range(2):
        im = Image.new('RGB', (900, 1200), 'white'); d = ImageDraw.Draw(im)
        d.text((60, 60), f'Fixture test page {i+1}', fill='black')
        p = os.path.join(OUT, f'page{i+1}.jpg'); im.save(p); paths.append(p)
    return paths

# A stand-in for claude.use("sample") that answers from the example kit and exercises the page's check tools.
MOCK = """
window.__log=[];
const KIT=%s;
const read={title:KIT.title,course:KIT.course,score:KIT.score,questions:KIT.test_questions.map(q=>Object.assign({},q,{steps:undefined,read_confidence:q.n===1?'unsure':'clear',unsure_note:q.n===1?'the last line is smudged':''}))};
const plan={student_summary:KIT.student_summary,background:KIT.background,practice:KIT.practice.map(p=>Object.assign({},p,{steps:undefined}))};
let walkCalls=0;
function sample(){return Promise.reject({code:'invalid_request'});}
sample.limits=async()=>({maxPromptBytes:262144,images:{maxCount:10,maxInputBytes:2e7,mediaTypes:['image/jpeg','image/png']},tools:{maxCount:8}});
sample.json=async(prompt,opts)=>{
  window.__log.push({head:prompt.slice(0,30),images:opts.images?opts.images.length:0,tools:!!opts.tools,markers:/\\[\\/?TOOLS\\]/.test(prompt)});
  if(opts.tools){ window.__tools=[(await opts.tools[0].execute({given_expr:'(5/2^(-2))^(-2)',expected:'1/400'})).equal,(await opts.tools[1].execute({lhs:'x^(-k+2)/x^(3k+7)',rhs:'x^15',var:'k',value:'-5'})).holds,(await opts.tools[0].execute({given_expr:'12^3*6^2/18^4',expected:'2'})).equal]; }
  await new Promise(r=>setTimeout(r,150));
  if(prompt.startsWith('You are reading')) return read;
  if(prompt.startsWith('A student took')) return plan;
  const items=JSON.parse(prompt.match(/\\n(\\[.*\\])\\n/)[1]);
  const out={items:items.map(it=>{const src=it.id[0]==='t'?KIT.test_questions.find(q=>'t'+q.n===it.id):KIT.practice.find(p=>'p'+p.n===it.id);return {id:it.id,steps:src.steps,check:src.check};})};
  if(++walkCalls===1){ const raw=JSON.stringify(out).replace(/\\\\\\\\/g,'\\\\'); throw {code:'invalid_json',text:'Here you go:\\n'+raw}; }
  return out;
};
const downloads={save:async(o)=>{window.__saved=(window.__saved||[]).concat([{filename:o.filename,len:o.data.length}]);}};
window.claude={use:async(n)=>n==='sample'?sample:n==='downloads'?downloads:null};
""" % json.dumps(KIT)

async def badges(pg):
    return await pg.evaluate('''()=>{const out=[];for(const sec of ['test','practice']){for(const c of document.querySelectorAll('#'+sec+'-chips .chip')){c.click();const t=document.querySelector('#'+sec+'-panel .check');out.push(t?t.textContent:'none');}}return out}''')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()

        # 1. Example page
        pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DOCS + '/example.html'); await pg.wait_for_timeout(400)
        bs = await badges(pg)
        check('example: 16 test + 10 practice chips', len(bs) == 26, bs)
        check('example: every checkable answer passes', bs.count('✓ checked') == 25 and 'double-check this one' not in ' '.join(bs), bs)
        check('example: no score shown', '27.5' not in (await pg.text_content('#app')))
        check('example: print buttons shown outside Claude', await pg.locator('.printbar button').count() == 2)
        check('example: no horizontal scroll at phone width', await pg.evaluate('document.documentElement.scrollWidth') <= 390)
        await pg.screenshot(path=os.path.join(OUT, 'example-phone.png'))
        await pg.emulate_media(media='print')
        await pg.pdf(path=os.path.join(OUT, 'example-sheet.pdf'), format='Letter', margin={k: '0.5in' for k in ('top', 'bottom', 'left', 'right')})
        pages = int(subprocess.run(['pdfinfo', os.path.join(OUT, 'example-sheet.pdf')], capture_output=True, text=True).stdout.split('Pages:')[1].split()[0])
        check('example: practice sheet prints on 2 pages or fewer', pages <= 2, pages)
        check('example: no page errors', not errs, errs)
        await pg.close()

        # 2. Landing page: copy and paste with any AI
        pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(DOCS + '/index.html'); await pg.wait_for_timeout(400)
        check('landing: shown outside Claude', await pg.is_visible('#landing'))
        prompt = await pg.text_content('#prompt-text')
        check('landing: both example thumbnails load', await pg.evaluate("[...document.querySelectorAll('.preview-card img')].filter(i=>i.complete&&i.naturalWidth>0).length") == 2)
        check('landing: parent prompt is filled in', 'test_questions' in prompt and len(prompt) > 2000)
        await pg.screenshot(path=os.path.join(OUT, 'landing-phone.png'), full_page=True)
        full = json.dumps(KIT)
        part1 = json.dumps({k: v for k, v in KIT.items() if k != 'practice'})
        part2 = json.dumps({'practice': KIT['practice']})
        cases = [('empty', '', 'Paste the AI'), ('cut off', full[:4000], 'cut off'),
                 ('part 1 only', 'Here is part 1:\n' + part1, 'only part 1'), ('not a kit', '{"a": 1}', "doesn't look like")]
        for name, text, expect in cases:
            await pg.fill('#kit-input', text); await pg.click('#kit-build')
            msg = await pg.text_content('#kit-error')
            check(f'landing: {name} gives a clear message', expect in msg, msg)
        unescaped = '```json\n' + part1.replace('\\\\', '\\') + '\n```\nSay continue for part 2.\ncontinue\n' + part2
        await pg.fill('#kit-input', unescaped); await pg.click('#kit-build'); await pg.wait_for_timeout(300)
        check('landing: a pasted kit goes to the review screen first', await pg.is_visible('#review') and await pg.locator('#review .qcard').count() == 5)
        await pg.click('#r-go'); await pg.wait_for_timeout(300)
        bs = await badges(pg)
        check('landing: two-part answer with unescaped LaTeX builds the full kit', len(bs) == 10 and all(x == '✓ checked' for x in bs), bs)
        check('landing: print and download buttons on the built kit', await pg.locator('.toolbar [data-p]').count() == 2 and await pg.locator('#dl-html').count() == 1)

        # Messy AI answers
        async def paste(text):
            await pg.goto(DOCS + '/index.html'); await pg.wait_for_timeout(200)
            await pg.evaluate("localStorage.clear()")
            await pg.goto(DOCS + '/index.html'); await pg.wait_for_timeout(200)
            await pg.fill('#kit-input', text); await pg.click('#kit-build'); await pg.wait_for_timeout(300)
            if await pg.is_visible('#r-go'):
                await pg.click('#r-go'); await pg.wait_for_timeout(300)
        # Copying a chat reply's rendered text (not its code block) adds a backslash and escapes '*'.
        md = json.dumps(KIT).replace('\\\\', '\\\\\\').replace('*', '\\*')
        await paste(md)
        bs = await badges(pg)
        check('messy: markdown-escaped copy still builds and checks', len(bs) == 10 and all(x == '✓ checked' for x in bs), bs)
        bad = json.loads(json.dumps(KIT))
        bad['practice'][0]['answer'] = '-\\dfrac{9}{8}'
        bad['test_questions'][1]['steps'][-1]['math'] = '\\dfrac{1}{25}'
        bad['test_questions'][0]['steps'][0]['caption'] = 'So (-4)^{-2} = \\dfrac{1}{16} \\cdot 2'
        bad['test_questions'][0]['steps'][0]['label'] = 'Step 1 \\cdot odd power'
        await paste(json.dumps(bad))
        bs = await badges(pg)
        check('messy: wrong answer field is flagged', bs[5] == 'double-check this one', bs)
        check('messy: final step that disagrees is flagged', bs[1] == 'double-check this one', bs)
        check('messy: other answers still pass', [b for i, b in enumerate(bs) if i not in (1, 5)] == ['✓ checked'] * 8, bs)
        await pg.click('#test-chips .chip >> nth=0')
        cap = await pg.text_content('#test-panel .caption')
        await pg.click('#test-panel .next')
        cap = await pg.text_content('#test-panel .caption'); lab = await pg.text_content('#test-panel .flabel')
        check('messy: LaTeX in captions and labels becomes readable text', cap == 'So (-4)⁻² = 1/16 · 2' and lab == 'Step 1 · odd power', [lab, cap])

        # Review screen: fix a misread before building
        rk = json.loads(json.dumps(KIT))
        rk['test_questions'][4]['read_confidence'] = 'unsure'; rk['test_questions'][4]['unsure_note'] = 'the last line is smudged'
        await pg.goto(DOCS + '/index.html'); await pg.evaluate("localStorage.clear()"); await pg.goto(DOCS + '/index.html'); await pg.wait_for_timeout(200)
        await pg.fill('#kit-input', json.dumps(rk)); await pg.click('#kit-build'); await pg.wait_for_timeout(300)
        check('review: unsure question is flagged and open for editing', await pg.locator('#review .qcard.unsure.editing').count() == 1)
        cards = pg.locator('#review .qcard')
        await cards.nth(3).locator('select').select_option('correct')            # AI marked #4 wrong; the teacher checked it
        await cards.nth(2).locator('.edit-toggle').click()
        await cards.nth(2).locator('input.latex').nth(1).fill('\\dfrac{7}{16}')  # change #3's answer
        await pg.fill('#r-title', 'Unit 4 Quiz')
        await pg.screenshot(path=os.path.join(OUT, 'review-phone.png'), full_page=True)
        await pg.click('#r-go'); await pg.wait_for_timeout(300)
        check('review: title change carries through', await pg.text_content('#title') == 'Unit 4 Quiz')
        check('review: status change carries through', await pg.get_attribute('#test-chips .chip >> nth=3', 'data-s') == 'correct')
        await pg.click('#test-chips .chip >> nth=2')
        note = await pg.text_content('#test-panel .panel')
        check('review: an edited answer is marked for a double-check, with no check tag', 'You changed this question' in note and await pg.locator('#test-panel .check').count() == 0)
        check('landing: no page errors', not errs, errs)
        await pg.close()

        # 3. Inside Claude: photo builder with a mocked Claude
        pg = await b.new_page(viewport={'width': 390, 'height': 844})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.add_init_script(MOCK)
        await pg.goto(DOCS + '/index.html'); await pg.wait_for_timeout(500)
        check('claude: photo builder shown', await pg.is_visible('#b-upload'))
        await pg.set_input_files('#photo-input', fixture_photos()); await pg.wait_for_timeout(200)
        await pg.click('#read-btn'); await pg.wait_for_selector('#b-confirm:not([hidden])', timeout=8000)
        check('claude: confirm screen lists every question', await pg.locator('.qcard').count() == 5)
        check('claude: unsure question is flagged and open', await pg.locator('.qcard.unsure.editing').count() == 1)
        await pg.locator('#qlist .qcard').nth(1).locator('.edit-toggle').click(); await pg.locator('#qlist .qcard').nth(1).locator('input.latex').nth(1).fill('\\dfrac{1}{144}')
        await pg.click('#build-btn'); await pg.wait_for_selector('#app:not([hidden])', timeout=20000); await pg.wait_for_timeout(300)
        log = await pg.evaluate('window.__log')
        check('claude: photos sent with the read call', log[0]['images'] == 2)
        check('claude: tool markers never reach Claude', not any(l['markers'] for l in log))
        check('claude: check tools accept right answers and reject wrong ones', await pg.evaluate('window.__tools') == [True, True, False])
        bs = await badges(pg)
        check('claude: built kit is complete and checked', len(bs) == 10 and all(x == '✓ checked' for x in bs), bs)
        await pg.click('#save-html'); await pg.click('#save-json'); await pg.wait_for_timeout(200)
        saved = await pg.evaluate('window.__saved') or []
        check('claude: printable page and JSON offered as downloads', [s['filename'].split('.')[-1] for s in saved] == ['html', 'json'], saved)
        check('claude: no page errors', not errs, errs)
        await b.close()

    print(f'\n{len(failures)} failed' if failures else '\nAll checks passed')
    sys.exit(1 if failures else 0)

asyncio.run(main())
