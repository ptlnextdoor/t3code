# DESIGN.md — the look and motion, extracted from grokbot ("sand"/cursor system)

Source of truth: `~/Downloads/asdfasdf` (grok-bot-0.18 reconstruction).
Aayu explicitly loves this app's aesthetics and animations. Everything below is
copied from its real tokens, not invented. Match it exactly; do not improvise.

## The metaphor (total commitment, heyclicky lesson)

A quiet, near-black instrument panel. Content floats on soft elevated cards over
a dimmed scrim. Nothing shouts. Hierarchy comes from _fill weight and spacing_,
not from color or borders. Values right-align; labels stay gray.

## Core palette (dark)

```
--chrome        #141414   window chrome / deepest
--editor        #181818   elevated surface, sidebar
--bg-secondary  #292929   card fill (settings rows)
--border        #393939   hairline (1px, always)
--text-primary  #F0F0F0   (base #F0F0F0)
--text-secondary  74% base
--text-tertiary   60% base
--text-quaternary 36% base
```

Fills are `color-mix(in srgb, var(--base) N%, transparent)`, never flat hexes:
`quinary 4%, quaternary 6%, tertiary 8%, secondary 14%, active 16%, primary 20%, focused 22%`.

Accents: accent `#599CE7`, green/success `#3FA266`, red `#FC6B83`, warn/yellow
`#F1B467`, purple `#9386F2`, orange `#D08770`, cyan `#88C0D0`.
Usage-meter fill is the signature lime `#c5f467`.

## Geometry

```
radius: xs 2, sm 4, base 6, lg 8, xl 12, 2xl 14, 3xl 16, full 9999
card/dialog radius: 14px      row radius: 9px      control radius: 6px
font-size: xs 11, sm 12, base 13, lg 14
line-height: xs 14, sm 16, base 18, lg 22
height: xs 20, sm 24, base 28, lg 32
letter-spacing base -.08px, lg -.15px
spacing scale: 4px steps (spacing-1 = 4px ... spacing-6 = 24px)
```

Section gap `24px`. Card padding `13px`. Dialog padding `24px`.
Grouped rows: first child `radius 9px 9px 0 0`, last `0 0 9px 9px`,
middle `border-top: 0`. That is how the Router usage list is built.

## Motion (the part he loves)

```
--duration-instant 50ms   --fast .1s   --normal .15s   --slow .2s   --slower .3s
--easing-out-quint     cubic-bezier(.16, 1, .3, 1)     <- the signature
--easing-out-strong    cubic-bezier(.165, .84, .44, 1)
--easing-in-out-strong cubic-bezier(.77, 0, .175, 1)
--press-scale .98
```

Real keyframes from the app:

```css
/* entrance: rise + settle. the one to reuse everywhere */
@keyframes sand-rise {
  0% {
    opacity: 0;
    transform: translateY(12px) scale(0.94);
  }
  55% {
    opacity: 1;
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
/* menus/popovers */
animation: 0.18s cubic-bezier(0.16, 1, 0.3, 1);
/* fades */
@keyframes sand-fade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}
/* shimmer sweep for loading */
@keyframes sand-sweep {
  0% {
    transform: translate(-100%);
  }
  100% {
    transform: translate(340%);
  }
}
/* spinner */
@keyframes sand-spin {
  0% {
    transform: rotate(0);
  }
  100% {
    transform: rotate(360deg);
  }
}
```

Rules: hover transitions are `background-color .12s ease` only. Press uses
`scale(.98)`. Entrances are `.18s` out-quint. Never animate layout properties.
Always honor `prefers-reduced-motion` by setting `animation: none`.

## Shadows

```
sm     0px 2px 8px 0px <shadow-secondary>
lg     inset 0 0 4px rgba(255,255,255,.05), 0 0 3px <shadow-2>, 0 16px 24px <shadow-3>
dialog 0 24px 80px rgba(0,0,0,.5)
```

Note the inset white 5% top-light on `lg`. That is what makes cards feel
physical rather than flat. Keep it.

## Scrim

`--bg-scrim #14141480`, heavy `#141414e5`. Dialogs sit on the scrim with
`backdrop-filter: blur()`, and the app behind stays visible but dimmed.

## Layout of the settings dialog (reference implementation)

```
dialog  min(860px, 100vw-32px) x min(620px, 100vh-32px), radius 14
layout  grid 190px | 1fr
nav     padding 54px 10px 12px, bg rgba(0,0,0,.14), right hairline
        item: 8px 10px, radius 6, gap 9, gray -> white when [data-active]
panel   h2 is 54px tall, padding 17px 24px, bottom hairline, 15px text
body    padding 24, overflow auto
```

## Non-negotiables

- Hairlines are always exactly 1px and low-contrast. No heavy borders.
- Labels gray, values white and right-aligned.
- Every list of facts becomes a grouped card, not loose text.
- 13px base font. 11px for hints/secondary.
- No emoji as UI chrome.
