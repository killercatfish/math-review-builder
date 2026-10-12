# Kit format (`math-review-kit/0.1`)

One JSON object drives a review kit. Every field is optional except that a kit needs `test_questions`, `practice`, or both.

```json
{
  "schema": "math-review-kit/0.1",
  "title": "Example: Exponents Quiz",
  "course": "Algebra 1",
  "score": "4.5 / 15",
  "student_summary": "3 to 4 plain sentences for the parent.",
  "test_questions": [ ... ],
  "background": [ ... ],
  "practice": [ ... ],
  "print_layout": [6, 4]
}
```

## `test_questions[]`

| Field | Meaning |
| --- | --- |
| `n` | Question number as printed on the test |
| `section`, `prompt` | Section heading and instruction ("Simplify. Positive exponents only.") |
| `problem` | The problem, in LaTeX |
| `answer` | The correct answer, in LaTeX. Shown only on the last walkthrough frame. |
| `student_answer` | What the student wrote, in LaTeX or a few words |
| `status` | `correct`, `partial`, `wrong`, `blank`, or `unknown` |
| `points` | As graded, e.g. `"3/4"`, or empty |
| `what_broke` | For partial or wrong: the exact move that broke, in plain words |
| `read_confidence`, `unsure_note` | `clear` or `unsure`, and what couldn't be read. Unsure questions open for editing on the review screen. |
| `edited` | Set by the review screen when a parent changed the problem or answer. The walkthrough is not regenerated, so the question is marked for a double-check and its machine check is dropped. |
| `check` | Machine check (below), or `null` |
| `steps` | Walkthrough frames (below) |

## `practice[]`

`n`, `section`, `prompt`, `problem`, `answer`, `check` and `steps` as above, plus `worked_solution`: an array of LaTeX lines printed in the answer key.

## `background[]`

`topic`, `explanation` (2 to 3 plain sentences), and `steps`. The first step is shown as the opening frame.

## Walkthrough steps

```json
{"label": "Step 2 · negative exponent", "math": "-8\\cdot\\warn{(-4)^{-2}}", "caption": "A negative exponent means flip it, then do the power."}
```

The player adds the bare problem as frame 1, so `steps` starts with the first move. Simplify problems end with an `Answer` frame; solve problems end with a `Check` frame.

## Math

KaTeX LaTeX without `$` delimiters, plus two macros:

- `\hl{...}`: terms or exponents being combined in this move (purple)
- `\warn{...}`: a sign, a negative exponent being applied, or an operation changing (yellow)

Backslashes are doubled inside JSON strings. The renderer repairs the common mistake of single backslashes (`\dfrac`, and `\frac` read as a form feed).

## `check`

Written in [math.js](https://mathjs.org) syntax, with `*` for every multiplication and single-letter variables. The browser evaluates both sides at three sets of positive values.

```json
{"type": "expr",  "given_expr": "(5/2^(-2))^(-2)", "expected": "1/400"}
{"type": "solve", "lhs": "x^(-k+2)/x^(3k+7)", "rhs": "x^15", "var": "k", "expected": "-5"}
```

For "create an example" questions, `given_expr` is the sample answer and `expected` is the target. Use `null` when there is nothing to check this way.

## `print_layout`

How many practice problems go on each printed page, e.g. `[6, 4]`. If it doesn't add up to the number of problems, the renderer picks a layout.

## Two-part answers

An AI may send a kit in two JSON objects, the second holding only `practice`. The landing page merges every JSON object in the pasted text, so parents can paste both parts together.
