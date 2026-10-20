---
name: Screenshot coverage
description: Avoid claiming complete visual coverage from DOM geometry when an image is clipped
---

Verify the saved image itself, not just fixture counts or offscreen DOM bounding boxes. Playwright's `fullPage` and `clip` options do not expose content hidden below an internally scrolling ancestor.

**Why:** All seven requested fixtures were present and passed geometry checks, but the initial saved Schedule images contained only the first four fixtures and the start of the next card.

**How to apply:** Keep the requested viewport width and timezone, but allow enough viewport height for the complete requested section, or capture and stitch scrolling regions. Check saved image dimensions against the requested section bounds and inspect its final content before delivering.
