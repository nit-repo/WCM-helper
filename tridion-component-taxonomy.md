# Tridion Component Taxonomy

How a KONE page is built, in three layers, and how each layer appears to this tool.

**Layer 1 — Component.** Tridion's authoring unit. A page is an ordered list of Component Presentations; each one is an instance of a component type (`HeroBanner`, `Accordion`, `ContentBlocks`, …). 49 component types are documented on `preview-training.kone.com/brand-refresh/`.

**Layer 2 — Field slot.** Each component exposes named content fields to the author (`heading`, `introduction`, `actiontext`, …). These are what a content brief's rows actually correspond to: a brief's "Headline" row is a heading-type slot, its "Introduction" row an intro-type slot.

**Layer 3 — Rendered markup.** What the tool can actually see. Two different page types, and the difference is the whole reason this taxonomy is needed:

| | CMS preview (`preview.kone.si`, `preview-training.kone.com`) | Live production (`kone.co.uk`, `kone.in`) |
|---|---|---|
| Component boundary | `<!-- Start Component Presentation: {"ComponentID":"tcm:151-142398",…} -->` | `<section class="module module-…">` only |
| Field boundary | `<!-- Start Component Field: {"XPath":"tcm:Content/custom:HeroBanner/custom:introduction"} -->` | none — CSS class/element only |
| Component + field name | exact, from the XPath | inferred from CSS class |
| Page id | `<meta name="pagetcmid">` | `<meta name="pagetcmid">` (present on both) |

**Confirmed**: live pages carry **zero** Tridion markers. Verified against the kone.co.uk MonoSpace 4 DX product page and the `kone-in-elevator-types-faq.html` fixture. The `pagetcmid` meta and `data-info="tcm:45-899-4"` navigation attributes survive to production; component and field markers do not.

## The XPath grammar

```
tcm:Content/custom:{ComponentType}/custom:{fieldName}
tcm:Content/custom:{ComponentType}/custom:{repeatable}[2]/custom:{fieldName}
```

- `{ComponentType}` — PascalCase, matches Layer 1 (`HeroBanner`, `ProductSpecification`)
- `{fieldName}` — camelCase, matches Layer 2 (`introduction`, `actiontext`, `bodytext`)
- Strip the `custom:` prefix and any `[N]` index; the index is the ordinal within a repeatable field and belongs in the locator's ordinal, not its name.

## Slot vocabulary

Across all 49 components the distinct slot *types* are only eight. Every component's fields reduce to these, which is what makes brief-field → slot matching tractable:

| Slot type | Field names seen | Brief row labels that map to it |
|---|---|---|
| heading | `heading`, `h1`, `title` | Headline, Title, H1, Section header |
| subtitle | `subtitle` | Subtitle, Kicker, Eyebrow |
| intro | `intro`, `introduction`, `leadtext` | Introduction, Intro, Lead, Standfirst |
| body | `body`, `bodytext` | Body, Body text, Copy, Paragraph |
| description | `description` | Description, Supporting text |
| cta | `cta`, `button`, `actiontext`, `actionurl` | CTA, Button, Link text |
| media | `image`, `alttext`, `caption` | Image, Alt text, Caption |
| label | `label` | (UI chrome — not usually briefed) |

## Component reference

Component → its documented field slots → the live-page CSS that carries them. A blank CSS column means no live-page instance has been observed yet; those components fall back to plain module-text matching until one is.

| Component | Field slots | Live CSS container | Live slot markup |
|---|---|---|---|
| HeroBanner | h1, heading, subtitle, intro, introduction, cta, button, image | `.hero-banner-wrapper` › `section.banner.hero-banner` | `header > h1` · `p.intro > span` · `a.btn.btn-hero` · `picture` |
| Accordion | h1, heading, subtitle, introduction, body text | `section.module.module-faq` | `header > h2` · `button.accordion-trigger` · `.accordion-panel .rtf .details` |
| ContentBlocks | heading, subtitle, description, image | `section.module.module-content-blocks` | `header > h2` · `article.content-block` › `p.subtitle` · `h3` · `div.details` · `div.media` |
| ProductSpecificationCarousel | introduction, body, body text, description, image, button | `section.module.module-product-specification-carousel` | `header > h2` · `.product-specification__item` › `.product-specification-header h3` + `p` · `ul.product-features li` (`.product-feature__label` + `.product-feature__spec`) |
| ProductTeaser | heading, subtitle, description, image | `section.module.module-product-teaser` | `header > h2` + `p` · `.product-teaser__item .rtf > h3` · `.details ul.product-features` |
| CampaignHighlight | cta, button, title, description, image | `section.module.module-campaign-highlights` | `h2` (often `style="display:none"`) · `article.campaign-highlights` › `h3` · `div.details` · `.actions a.btn` · `.campaign-highlights__media` |
| Form (lead capture) | heading, introduction | `section.module.module-form` | `header > h2` + `p.intro` · `div.fa-form` (FormAssembly — no briefable copy inside) |
| ContentRiver | introduction, body, body text, description, image | `.content.content-river` | `.rtf` blocks |
| MultiCTAModule | subtitle, introduction, cta, button | `.cta-list` | `a.btn` |
| Breadcrumbs | label | `section.module-breadcrumbs` | `a` — chrome, never briefed |
| Article | h1, heading, intro, introduction, body, body text, image, caption | | |
| ContentHeading | h1, heading, lead text, subtitle, intro, introduction, description, image | | |
| Business | cta, button, heading, subtitle, introduction, description, image | | |
| Contact | cta, button, heading, intro, body text, description, image, caption | | |
| HighlightTeaser | heading, subtitle, intro, introduction, description, image | | |
| History | heading, introduction, body, body text, description, image | | |
| ImageBanner | heading, subtitle, introduction, description, image | | |
| InfoModules | heading, subtitle, introduction, body, body text, description, image | | |
| MediaCarousel | subtitle, introduction, description, image | | |
| Mosaic | subtitle, introduction, description, image | | |
| PeopleIntroCarousel | heading, subtitle, introduction, body, body text, description, image, button | | |
| Podcast | subtitle, intro, introduction | | |
| PPCards | h1, heading, subtitle, introduction, description, image | | |
| PPTiles | heading, subtitle, intro, introduction, cta, button, description, image | | |
| ProcessModules | subtitle, introduction, cta, button, description, image | | |
| Quote | subtitle, introduction, body, image | | |
| QuickLinks | introduction, body, body text, description, image | | |
| SelectedHighlights | subtitle, introduction, cta, button, description, image | | |
| SMB | title, introduction, description, button | | |
| StoryHighlights | introduction, image | | |
| Table | introduction, body, button | | |
| Teasers | subtitle, introduction, description, image | | |
| ToolsAndDownloads | subtitle, introduction, cta, description, image | | |
| VideoBB | introduction, description, image | | |
| VideoParallax | introduction | | |

Remaining documented components with no briefable prose slots or no observed live instance: `fhs`, `gated-content`, `header-and-navigation`, `iframe`, `local-website-selection`, `news-ref-carousel`, `officesearchmap`, `office`, `panorama`, `publicationcenter`, `sitemap`, `social-media-feed`, `vcalc`, `contactpersons`, `country-selector`, `news-and-ref-filter`, `service-lead-form`, `maintenance-lead-form`.

## Page chrome — never a component match

These carry text but never carry briefed content. Anything matching only here is a false positive:

`header.kone-header` · `section.kone-header-navigation` · `footer.kone-footer` (`.footer__top`, `.footer__middle`, `.footer__bottomlinks`) · `section.footer__bottomtext` · `section#cookiepopup` · `section.module-breadcrumbs`

## Worked example — kone.co.uk MonoSpace 4 DX

`https://www.kone.co.uk/new-buildings/lifts-elevators/kone-monospace-4dx/`, `pagetcmid` `tcm:45-128164-64`, zero Tridion markers. Components in document order:

1. `section.module-breadcrumbs` → Breadcrumbs *(chrome)*
2. `div.hero-banner-wrapper` › `section#item-128155.banner.hero-banner` → **HeroBanner** — `h1`, `p.intro`, CTA "Contact us"
3. `section#item-128158.module.module-content-blocks.layout-cards` → **ContentBlocks** — h2 "Unleash new possibilities", 3 × `article.content-block`
4. `section.module.module-product-specification-carousel` › `#item-129702` → **ProductSpecificationCarousel**
5. `section#item-128160.module.module-faq` → **Accordion** — h2 "Downloads and specifications"
6. `section.module.module-product-teaser` → **ProductTeaser**
7. `section#item-128163.module.module-campaign-highlights` → **CampaignHighlight**
8. `section#item-84283.module.module-form` → **Form**
9. `footer.kone-footer`, `section#cookiepopup` → *(chrome)*

The `#item-NNNNNN` ids are the component instance ids and survive to production — the same number the CMS knows the component by. They are a usable secondary signal for component identity even without markers, though they name the instance, not its type.
