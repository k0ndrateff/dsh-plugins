# dsh-integration-ui

The browser-half shell every integration plugin here shares: the side-panel body
that loads, fails, retries and writes one thing at a time, the result card under
the answer, the terse tool row, the settings card, and the stylesheet they are
drawn with. A plugin supplies its payload, its drawing rules, and its own tab
kind.

`dsh-integration-ui/styles` is that stylesheet and its theme contract; a plugin's
own `styles.css.ts` re-exports it, so its components import every class — shared
and its own — from one place. vanilla-extract compiles each `*.css.ts` with its
own esbuild run and forwards no `alias`, which is why `dsh-plugin-build` hands its
workspace resolver into `esbuildOptions.plugins`.

A plugin still registers each seat itself, under its own tab kind and its own tool
names: a kind is what `openTab` names and what the Sidebar keys a panel body by.
