# Company Email channels

Use **Connectors → Company channels** to connect a Gmail or Microsoft 365/Outlook inbox to one CEO company. This is the company-level equivalent of the WhatsApp/voice channel setup. It is not a second inbox.

## Configure a mailbox

1. Select Gmail or Microsoft 365 / Outlook.
2. Enter the mailbox address and an optional display name.
3. Choose inbound, outbound, or both.
4. Choose how **non-campaign** messages should be handled: keep them in the Live Event Inbox, run an owner-scoped workflow, or create a goal for an enabled company agent.
5. Optionally select the Marketing Specialist for campaign-response work.
6. Save, choose **Connect OAuth**, complete the provider popup, then **Test** and **Enable**.

OAuth access and refresh tokens stay in OpenConnector's vault. Flolah stores only the owner-scoped connection reference, mailbox routing policy, health timestamps and privacy-minimized processing receipts. Never paste a mailbox password or OAuth token into chat or Marketing.

## Where incoming email goes

- A reply from a consented campaign recipient with a recent send receipt is attributed to that campaign. Marketing records reply/opt-out evidence and prepares or updates **Marketing → Leads & follow-up**.
- Any other message becomes an `email.message.received` event in **Connectors → Events & Productivity → Live event inbox**. It then follows the selected inbox, workflow, or goal route.
- Provider message IDs make retries idempotent. Routing receipts do not store the message body. Event content is retained only in the existing owner-scoped Events & Productivity store and follows the user's data-retention policy.

The platform polls enabled inboxes every five minutes by default. **Sync now** runs an immediate check. The initial lookback is configurable from 1 hour to 7 days, so a recently received reply can be captured after first setup.

## Marketing and Action Control

The Marketing Channels screen shows readiness but does not store credentials. External sends and replies continue to use the provider connector tools. They remain classified as **External messages / publish (R2)** and follow the CEO's Action Control policy and scoped overrides. Inbox reading and attribution do not bypass the policy for later external actions.

## Troubleshooting

- **Connection required**: complete provider OAuth under the channel card. A Gmail connection cannot enable an Outlook channel, or vice versa.
- **Test failed**: reconnect the provider and confirm the signed-in provider account can read the configured mailbox.
- **No reply appears**: confirm the channel is enabled, inbound direction is allowed, and press **Sync now**. Review the channel error and Events & Productivity Live Event Inbox.
- **Reply is not a lead**: attribution requires a real recent campaign send receipt and a consented audience-list identity. Unmatched email is intentionally treated as normal company mail.
