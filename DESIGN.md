---
version: alpha
name: Dhanavi
description: Business owner workspace and public customer chat
colors:
  primary: '#285846'
  background: '#f6f3eb'
  text: '#283c32'
  muted: '#78816e'
  border: '#dfe4d5'
  accent: '#b94e32'
typography:
  sans:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  mono:
    fontFamily: 'monospace'
rounded:
  DEFAULT: '8px'
  lg: '12px'
spacing:
  card-padding: '20px'
components:
  button: {}
  card: {}
  input: {}
---

# Dhanavi design context

A small shop's paper ledger and botanical stationery inform the existing warm paper surfaces, forest green actions and restrained clay accents. Preserve this identity when extending the owner workspace and public chat. Avoid financial dashboard styling or attention-grabbing payment banners.

This is an English product interface for small business owners and their customers. The requested booking payment feature targets Indian UPI users and displays INR; it does not introduce Japanese localization or a new theme. Owners work through Today and Customers; customers primarily use a phone.

`public/style.css` is the canonical runtime palette and component owner. This file records it rather than generating tokens. Existing `.card`, `.question`, `.button`, `.form-grid`, `.check`, `.callout`, `.inline-error` and focus styling own payment UI appearance. `public/app.js` owns the shared rendering and toast behavior. White-paper fields have 8px corners; payment cards have 12px corners. Buttons preserve the shared green/secondary hierarchy; status always includes text.

Use existing responsive breakpoints (700px owner navigation, 1000px single-column fields); booking controls wrap and remain usable at 390px. No fixed page height is added. Payment errors appear inline with focus on the invalid input. Pending writes disable duplicate actions. Customer details remain in memory during refreshes; payment settings survive refreshes on the server. The owner explicitly reviews exact payment values before confirmation. Long booking details wrap rather than widening the page.

Shared scrollbars inherit the paper track and muted green thumb, with focus and forced-colors support. This scoped feature does not redesign existing authentication, saved-answer deletion, typography or chat layouts.
