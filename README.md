# Carrd Bulk Embed Importer

Tampermonkey userscript for importing segmented UTF-8 `.txt` files into Carrd Code embeds.

## Install

1. Install Tampermonkey in your browser.
2. Open `carrd-bulk-embeds.user.js`, copy its entire contents into a new Tampermonkey script, and save.
3. Reload your Carrd editor. The **Carrd bulk embeds · 1.4** panel appears at the bottom right.

## Use

1. Choose or drop all your segmented TXT files into the panel.
2. Review their order. Numbered filenames sort naturally; arrows let you reorder them.
3. Choose **Update** or **Replace**, select naming and placement options, and click **Review & run**.
4. Review the finished embeds, then save or publish through Carrd yourself.

Each TXT file becomes one Code embed. With 17 files, the default embed names are **0–16**. You can instead use filenames or keep existing names. Automatic backup downloads are **off by default**; an optional checkbox and manual backup button are available.

## Behavior

- **Update** rewrites existing embeds in document order and creates any missing embeds after the preceding one, inside its container.
- **Replace** stages new embeds beside the originals, verifies their content, then deletes the originals. This temporarily needs extra element capacity.
- Existing placement and script defer settings are preserved during updates. Replacement copies these settings by position.
- Code is written using Carrd's property setter to preserve whitespace and is read back for verification.
- The importer does not publish your site or execute the imported code itself.

## Limits

- All Code embeds on the site are included, including unrelated ones. Exit Section View before importing.
- Each segment must fit Carrd's code-field limit, currently observed as 16,384 characters.
- The in-memory backup covers code, titles, placement and defer settings. It does not recreate custom IDs or other advanced attributes, and is lost when the page reloads unless downloaded.
- Updates with fewer files than existing embeds stop; use Replace if you intend to remove extras.
- Carrd Pro access to Code embeds is required. Carrd editor changes may require a userscript update.

## Version

**1.4.0** — numeric naming by default, selectable naming mode, and opt-in automatic backup downloads.
