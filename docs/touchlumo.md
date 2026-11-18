# Touchlumo integration

The standalone application and optional host component share the LumoDossier API. Integration is opt-in. This repository contains the component and integration entry point. The existing Touchlumo repository and production deployment are managed separately.

## Identity and permissions

Use the same isolated Supabase Auth issuer and database as the connected Touchlumo test workspace. Enable `TOUCHLUMO_ENABLED=true` on the signing API and set `CRM_ORIGIN` to the exact approved CRM frontend origin. The signing origin stays in `WEB_ORIGIN`. Privileged credentials belong on the signing server.

Every sender call first verifies the bearer with Supabase Auth. For a Touchlumo workspace the API reads `public.workspace_members` and `public.workspaces` through Supabase PostgREST with the sender's bearer. The CRM's current membership and RLS policies determine which workspace the user can access. Owners and members can prepare, send and manage requests. Viewers can inspect requests and download permitted documents. Native LumoDossier workspaces use the separate `lumo.members` table. Administrators can provision standalone member and viewer assignments there. The dashboard creates an owner membership when creating a standalone workspace.

The adapter reads `public.contacts`, `public.quotes` and `public.deals` with both the requested ID and verified workspace ID. It confirms that linked records have compatible customers, applies existing CRM read policies, and resolves recipient names and email addresses on the server. It rechecks references when saving and sending. A standalone request needs only a PDF and its recipients.

## Mount the feature

Use the label **LumoDossier — Documents & Signatures** in Touchlumo navigation. Mount the exported React component in a CRM route or related-record panel. The component polls the shared document API, accepts the CRM's access-token getter and downloads the finished PDF through an authorized request. Its source and the small shared type module are available under `apps/web/integrations` and `apps/web/lib/types.ts`.

```tsx
<TouchlumoDocuments
  workspaceId={workspace.id}
  role={membership.role}
  crm={{ customer: customer.id }}
  apiOrigin={signingApiOrigin}
  webOrigin={signingWebOrigin}
  getAccessToken={getCurrentSupabaseAccessToken}
/>
```

Use `crm={{ quote: quote.id, customer: quote.contact_id }}` for a quote with a customer, or `crm={{ deal: deal.id }}` for a deal. Omit absent references. The list endpoint combines supplied associations, so pass a single customer reference for all requests associated with that customer. Use a stable token getter and a component key based on the active workspace and related record.

An alternative navigation target is `/touchlumo?workspace=<workspace-uuid>` on the signing frontend. Customer, quote and deal pages may append `customer`, `quote` or `deal` with their UUIDs. The **New signature request** action preserves that context and prefills recipients after upload. The standalone site's own Supabase session authorizes navigation between origins. A user signs in on the signing origin when necessary. Access tokens stay in authorization headers.

The browser tests verify the panel, prefilling, shared completion status and authorized download with an isolated CRM adapter. Connecting this component to the live Touchlumo navigation and testing actual CRM RLS require a configured shared testing deployment.
