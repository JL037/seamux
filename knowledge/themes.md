# Themes

How the browser treats the CSS custom properties a theme is made of: what a value can reach once it's in a `<style>`, how a colour derived from another one resolves, and how a theme's rules meet seamux's own light and dark tokens in [app.css](../app/app.css). Measured in headless Chrome 154.0.8037.95 on macOS 26.5.1, from a page served on 127.0.0.1; Safari and Firefox are unmeasured. [Measuring](measuring.md#read-a-page-in-headless-chrome) has how.

## A CSS escape spells `url(` past a ban on the text

`#esc { --img: \75 rl(http://127.0.0.1:54999/hit-escaped); background-image: var(--img); }` made Chrome request `/hit-escaped`, and `getComputedStyle` gave its `background-image` as `url("http://127.0.0.1:54999/hit-escaped")`. `\75 ` is the escape for `u`, and the tokenizer decodes it before it decides the token is a URL, so the source text never contains `url(`. The quoted form, `\75 rl("…")`, came out as a URL too. The custom property itself reads back as typed, `\75 rl(http://…)`, so checking the stored value for `url(` finds nothing.

A ban on words in a theme's values can always be spelled around like this. A theme's value has to be parsed into what it means, a colour's numbers or a length's number and unit, and the CSS written from those, so nothing the author typed reaches the page as text.

- **Measured:** Chrome 154.0.8037.95, macOS 26.5.1.

## A relative colour in a custom property resolves where it's declared

With `:root { --brand: #5ecdfa; --background: oklch(from var(--brand) 0.175 0.028 h); }`, an element that set its own `--brand: #ff0000` and used `background-color: var(--background)` was still painted `oklch(0.175 0.028 227.751)`, the hue of `#5ecdfa`. It inherited `--background` already worked out at `:root`. Declaring `--background` again on that element, next to its `--brand`, gave `oklch(0.175 0.028 29.2346)`, the hue of `#ff0000`.

Setting `--brand: #ff0000` from `html[data-theme="duck"]`, on the same element as `:root`, moved `--background` from hue 227.751 to 29.2346 as soon as the attribute was added. Tokens derived from the brand in `:root` follow a theme that sets the brand on `<html>`, and on no other element.

- **Measured:** Chrome 154.0.8037.95, macOS 26.5.1.
- **In seamux:** `--scrollbar-thumb-hover` in [app.css](../app/app.css) is the one token derived this way so far.

## `getComputedStyle` gives a custom property back as text, not as a colour

`getComputedStyle(document.documentElement).getPropertyValue("--background")` returned `oklch(from #5ecdfa 0.175 0.028 h)`: the `var()` substituted, the colour not worked out. The same token read through a real property, an element's `background-color: var(--background)`, came back as `oklch(0.175 0.028 227.751)`. To show what a derived token works out to, read it through a property that takes a colour.

- **Measured:** Chrome 154.0.8037.95, macOS 26.5.1.
- **See also:** [A relative colour in a custom property resolves where it's declared](#a-relative-colour-in-a-custom-property-resolves-where-its-declared).

## A custom property that can't be worked out leaves its property blank, not the earlier value

An element with `background-color: red` in one rule and `--c2: notacolor; background-color: var(--c2)` in a later one was painted `rgba(0, 0, 0, 0)`, not red. So was one using `oklch(from var(--nope) l c h)` with `--nope` undefined. The browser accepts `var()` when it reads the stylesheet and finds the value is bad only when it works it out, by which time the earlier declaration has already lost. A bad token in a theme blanks whatever uses it; it doesn't fall back to seamux's own value.

- **Measured:** Chrome 154.0.8037.95, macOS 26.5.1.

## A theme's light rules outrank seamux's `.dark` tokens

app.css sets the light tokens on `:root` and the dark ones on `.dark`. A test page with `:root { --bg2: oklch(0.98 0.005 262) }`, `.dark { --bg2: oklch(0.175 0.028 262) }` and a theme's light rule `html[data-theme="duck"] { --bg2: rgb(255, 0, 0) }` painted `oklch(0.98 0.005 262)` in light mode and `oklch(0.175 0.028 262)` with `.dark` on `<html>`. With `data-theme="duck"` added as well, still dark, it painted `rgb(255, 0, 0)`, the theme's light value. `html[data-theme="duck"]` is a type selector and an attribute, which outranks the one class in `.dark`, so whatever a theme sets for light also replaces seamux's dark value, unless the theme's own dark rule sets it again. A theme's light rule has to exclude dark mode, as `html[data-theme="duck"]:not(.dark)` does.

- **Measured:** Chrome 154.0.8037.95, macOS 26.5.1.
- **In seamux:** the `:root` and `.dark` blocks in [app.css](../app/app.css).
