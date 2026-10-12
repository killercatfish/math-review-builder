"""Build the site into docs/.

Inlines KaTeX (with its fonts), math.js, the parent prompt and the main script into
src/template.html so every page works offline as a single file.

  docs/index.html    the builder: photo builder inside Claude, copy-and-paste landing everywhere else
  docs/example.html  the example kit, baked in

The landing page previews come from examples/thumb-*.jpg (made by scripts/make_thumbnails.py).
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NM = os.path.join(ROOT, 'node_modules')
# The photo builder published as a Claude artifact (runs on each visitor's own Claude account).
CLAUDE_URL = os.environ.get('CLAUDE_BUILDER_URL', 'https://claude.ai/artifact/CZaCAsKoEEF2M2cJFHyk2Q')

def read(*p, mode='r'):
    with open(os.path.join(ROOT, *p), mode) as f:
        return f.read()

def no_script_close(s):
    return re.sub(r'</(script)', r'<\\/\1', s, flags=re.I)

def katex_css():
    css = read('node_modules', 'katex', 'dist', 'katex.min.css')
    def font(m):
        data = base64.b64encode(read('node_modules', 'katex', 'dist', 'fonts', m.group(1) + '.woff2', mode='rb')).decode()
        return 'src:url(data:font/woff2;base64,' + data + ') format("woff2")'
    css = re.sub(r'src:url\(fonts/([A-Za-z0-9_-]+)\.woff2\)[^;}]*', font, css)
    assert 'fonts/' not in css, 'a KaTeX font was not inlined'
    return css

def page(kit=None, title=None):
    t = read('src', 'template.html')
    main = read('src', 'main.js')
    main = main.replace('/*PARENT_PROMPT*/""', json.dumps(read('prompt', 'parent-prompt.txt'), ensure_ascii=False))
    main = main.replace('/*CLAUDE_URL*/""', json.dumps(CLAUDE_URL))
    thumbs = {}
    for key, name in (('walk', 'thumb-walkthrough.jpg'), ('sheet', 'thumb-sheet.jpg')):
        path = os.path.join(ROOT, 'examples', name)
        if os.path.exists(path):
            thumbs[key] = 'data:image/jpeg;base64,' + base64.b64encode(read('examples', name, mode='rb')).decode()
    main = main.replace('/*THUMBS*/{}', json.dumps(thumbs))
    i = t.index('<script data-kit="main">')
    t = t[:i] + '<script data-kit="main">\n' + no_script_close(main) + '\n</script>\n'
    t = (t.replace('/*KATEX_CSS*/', katex_css())
          .replace('/*KATEX_JS*/', no_script_close(read('node_modules', 'katex', 'dist', 'katex.min.js')))
          .replace('/*MATHJS*/', no_script_close(read('node_modules', 'mathjs', 'lib', 'browser', 'math.js')))
          .replace('/*KIT_JSON*/', no_script_close(json.dumps(kit, ensure_ascii=False)) if kit else ''))
    if title:
        t = re.sub(r'<title>.*?</title>', '<title>' + title + '</title>', t, count=1)
    return t

def full_document(body):
    # GitHub Pages serves files as-is, so give them a real document shell.
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '</head><body>\n' + body + '\n</body></html>\n')

def main():
    if not os.path.isdir(NM):
        sys.exit('Run `npm install` first (KaTeX and math.js are inlined from node_modules).')
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    example = json.loads(read('examples', 'chapter8-real-kit.json'))
    outputs = {
        'index.html': full_document(page(title='Math Test Review Builder')),
        'example.html': full_document(page(kit=example, title='Example Review Kit')),
        # Same page without the document shell, for publishing as a Claude artifact.
        'artifact.html': page(title='Test Review Builder'),
    }
    for name, html in outputs.items():
        path = os.path.join(ROOT, 'build' if name == 'artifact.html' else 'docs', name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(html)
        print(f'{os.path.relpath(path, ROOT)}  {len(html)//1024} KB')

if __name__ == '__main__':
    main()
