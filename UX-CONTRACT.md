# Booking payment UI contract

Business source: the user-approved workflow in this task, implemented in `src/payments.ts` and described in README.md, Booking advances (UPI). Existing authentication and business/guest isolation are enforced by `src/platform.ts`.

| Capability | Canonical owner | Behavior and verification |
| --- | --- | --- |
| Form | `public/app.js` paymentSetup / wirePayments | Today: edit → review → explicit confirmation of recipient and amount. Inline errors retain values and focus the invalid field; POST validates again. Browser + API tests. |
| Toast | `public/app.js` toast | Shared acknowledgement; errors and required review remain inline. |
| Scrollbar | `public/style.css` | Global visible scrollbar baseline, forced-colors fallback. |
| CRUD and state | `src/payments.ts` | Server controls booking/payment transitions, isolates tenants/guests and retains request snapshots. API tests. |
| Customer actions | `public/app.js` customerBookingCard | Details + review checkbox precede request; payment report precedes manual owner verification; receipt verification precedes booking confirmation. Browser + API tests. |

Owner payment settings are private. Issued requests expose only their snapshot to their conversation. Editing a saved setting pauses new requests until explicitly confirmed again; the revision check rejects stale confirmations. Existing requests keep their original amount and recipient. Duplicate reports and confirmations are idempotent. Neither the model nor a deep-link return may verify receipt. Links navigate to installed payment apps; they never indicate payment success.

Today and Customers use the same owner booking renderer and actions. Opening the conversation selects its thread in Customers. Customer booking errors are inline; owner verification feedback also appears durably in the customer conversation. Notifications remain in-app.
