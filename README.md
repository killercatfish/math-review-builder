# Math Test Review Builder

Turn photos of your child's graded math test into a review kit:

- **A walkthrough of every question.** Each one opens on the bare problem ("try it on paper first"), then steps through one move at a time, with the trap called out at the moment it happens.
- **Refreshers** on the skills underneath the missed points, such as fraction arithmetic or distributing a minus sign.
- **New practice problems** with the same traps and fresh numbers, each with its own walkthrough.
- **A printable practice sheet** with boxed work space, plus a separate answer key with every step worked out.

It's free, and it works with the AI you already use: Claude, ChatGPT, Gemini, or anything else that can read photos.

**[Open the builder](https://killercatfish.github.io/math-review-builder/)** · **[See an example kit](https://killercatfish.github.io/math-review-builder/example.html)**

The example is a real Algebra 1 exponents test (16 questions, score removed), so you can see exactly what a parent gets back.

## How a parent uses it

1. Open the builder and copy the prompt.
2. Start a new chat with your AI, attach a photo of every page of the graded test, paste the prompt, and send.
3. Paste the AI's answer back into the builder and check what it read: AI can misread handwriting or a teacher's marks, so you can fix any question before the review is built in your browser.

From there you can print the practice sheet and the answer key, or download the whole review as one file that works offline.

Inside Claude there is also a [photo builder](https://claude.ai/artifact/CZaCAsKoEEF2M2cJFHyk2Q) that skips the copy and paste. Claude reads the test on your own Claude account, shows you what it read so you can fix anything, then builds the kit, checking its answers as it goes.

## Can I trust the answers?

AI can make mistakes, so the kit carries a machine check for every answer it can check: the original expression and the answer, written so a computer can test them. Your browser plugs numbers into both. Matching answers get a "checked" tag. Anything that doesn't match is marked "double-check this one." Questions that can't be checked this way, like "explain why," have no tag. When in doubt, trust the teacher.

## Privacy

This site has no server. The test photos go only to the AI you choose, under your own account, and the review is built in your browser. Nothing is uploaded here. A kit you build is remembered only in your own browser so you can reopen it, and the "Start a new kit" button clears it.

## How it works

One JSON file drives everything: the walkthroughs, the practice problems, the print sheet and the key. The AI writes the JSON; this page renders it. [`SCHEMA.md`](SCHEMA.md) describes the format, and [`prompt/parent-prompt.txt`](prompt/parent-prompt.txt) is the prompt parents copy.

| Path | What it is |
| --- | --- |
| `src/template.html` | Page layout, styles, and print styles |
| `src/main.js` | Renderer, walkthrough player, answer checks, the photo builder for Claude, and the copy-and-paste landing page |
| `prompt/parent-prompt.txt` | The prompt for any AI |
| `examples/chapter8-real-kit.json` | The example on the site: a real Algebra 1 exponents test, used with permission, score removed |
| `examples/example-kit.json` | A small fictional kit used by the tests |
| `scripts/build.py` | Inlines KaTeX, math.js, the prompt, and the script into single-file pages |
| `scripts/make_thumbnails.py` | Renders the landing-page preview images from the example kit |
| `docs/` | The built site, served by GitHub Pages |
| `tests/run_tests.py` | End-to-end checks with Playwright |

### Build and test

```sh
npm install                 # KaTeX and math.js, inlined at build time
python3 scripts/build.py    # writes docs/index.html, docs/example.html, build/artifact.html
python3 scripts/make_thumbnails.py  # optional: refresh the landing-page previews, then build again
python3 tests/run_tests.py  # needs: pip install playwright pillow && playwright install chromium
```

Each built page is a single self-contained file (about 1.4 MB) that works offline. `build/artifact.html` is the same builder without a document shell, for publishing as a Claude artifact. That artifact declares the `sample` capability with images, and `downloads`. To link the landing page to a public copy of it, set `CLAUDE_BUILDER_URL` when building.

## License

[CC BY-NC 4.0](LICENSE): free to use, share, and adapt for non-commercial purposes, with credit. Made by Josh Gold, Gold's Honey LLC.
