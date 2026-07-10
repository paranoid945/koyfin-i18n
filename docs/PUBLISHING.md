# Publishing to the Chrome Web Store

A step-by-step guide for publishing (and updating) this extension.

## One-time setup

1. **Developer account.** Sign in at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   and pay the one-time **$5 USD** registration fee.
2. Verify your contact email under **Account** in the dashboard (required
   before you can publish).

## Build the upload package

```sh
npm run package
```

This regenerates `locales/` and `icons/` and produces
`dist/koyfin-i18n-<version>.zip` containing only the files the extension
needs (`manifest.json`, `src/`, `locales/`, `icons/`, `LICENSE`).

## Create the listing

In the dashboard, click **New item** and upload the zip. Then fill in:

### Store listing

- **Name:** Koyfin UI Translator
- **Summary:** Translate Koyfin's interface into Chinese, Japanese,
  Korean, German, French or Spanish — fully offline.
- **Description:** explain what is translated (static UI labels) and what
  is not (dynamic content), list the supported languages, and note that no
  data leaves the browser. Linking to the GitHub repository is recommended.
- **Category:** Tools (or Productivity).
- **Icon:** upload `icons/icon128.png`.
- **Screenshots:** at least one 1280×800 (or 640×400) screenshot. Take
  screenshots of app.koyfin.com with translation enabled — e.g. the
  sidebar and a watchlist in Chinese.

### Privacy tab

- **Single purpose:** "Translates Koyfin's static interface labels into
  the user's chosen language using a bundled offline dictionary."
- **Permission justifications:**
  - `storage` — saves the user's language choice and on/off toggle.
  - Host access (`koyfin.com`) — required to read and replace interface
    labels on Koyfin pages; the extension runs nowhere else.
- **Data usage:** declare that **no user data is collected**. Point the
  privacy policy field at `PRIVACY.md` in the GitHub repository (use the
  raw or rendered GitHub URL).
- Certify the disclosures.

### Distribution

- **Visibility:** Public (or Unlisted while testing with friends).
- **Regions:** all regions.

## Submit for review

Click **Submit for review**. Extensions with narrow host permissions and
no remote code typically pass review within a few business days. You will
be emailed on approval or rejection.

## Releasing an update

1. Bump `"version"` in `manifest.json` (and `package.json`).
2. `npm run package`
3. In the dashboard, open the item → **Package** → **Upload new package**,
   then submit for review again. Users receive the update automatically.

## Review-friendliness notes

- All code is plain, unminified JavaScript — no bundler, no remote code,
  no `eval`. This makes review fast; keep it that way.
- If a reviewer asks about the trademark, note in the listing that the
  project is unofficial and not affiliated with Koyfin. Avoid using
  Koyfin's logo in the icon or promotional images.
