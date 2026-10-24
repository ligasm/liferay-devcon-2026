# Making Liferay call the webhook

The static site regenerates on a timer anyway; a webhook only makes edits show up
in seconds instead of minutes. Any of these work — pick the one your DXP version has:

1. **Object Actions (DXP 7.4+/2023+)** — for content stored in Objects: Control Panel →
   Objects → *your object* → Actions → *Add Action* → trigger `On After Update`
   (and Add/Delete), action type **Webhook**, URL `https://<host>:8787/hooks/liferay`,
   secret header `X-Webhook-Secret: <WEBHOOK_SECRET>`.
2. **Workflow / Notification Templates** — attach a *Webhook* notification to the
   publish transition of your workflow so only *published* changes trigger a cycle.
3. **Client Extension (`webhook` / `objectAction` type)** or a tiny OSGi
   `ModelListener` on `BlogsEntry` / `JournalArticle` / `Layout` for content types
   that are not Objects: `onAfterUpdate` → `HttpClient.post(...)`.
4. **No hook at all**: keep the 15-minute timer. `regenerate.mjs` costs ~1 s and
   zero tokens when nothing changed, so polling is cheap.

The receiver debounces (`WEBHOOK_DEBOUNCE_MS`, default 20 s): an editor saving
ten times in a row causes one regeneration, not ten.
