# Verification

## Google Cloud Run

The public home page and database-backed API health check returned HTTP 200. Anonymous workspace access returned HTTP 401. A disposable confirmed Supabase account signed in, created a workspace, uploaded a PDF and shared a manual link. A separate phone-sized browser session signed through the private link and downloaded the completed PDF. The on-device verifier matched the exact copy and detected a one-byte alteration. The test removed the disposable sender login. The private Cloud Run worker completed successfully. [Hosted LumoDossier](https://lumodossier-web-269702414030.us-east1.run.app)

## Local verification

Verified on Windows on November 18, 2026 using Node 24.19.0 and pnpm 12.5.1.

| Area | Observed result |
| --- | --- |
| Static checks and production builds | ESLint, TypeScript for both apps and the API test sources, and both production builds passed. |
| API and document processing | All 18 tests passed. An isolated PostgreSQL 18 cluster exercised independent connections, concurrent recipient submissions, frozen versions, RLS, recipient assignment, role restrictions, expiring and revoked links, retries and workflow state. |
| Persistence and processing | The test stopped the actual PostgreSQL server and API, reopened the database, resumed the queued original-file write, and accessed the same request using the previously issued recipient link. Another test recovered an interrupted storage write and expired worker leases. |
| PDF placement | Poppler rendered completed values in the expected regions on cropped pages at 0°, 90°, 180° and 270°. The tests checked nondefault PDF units, deterministic output and preserved original bytes. |
| Browser workflow | Five Chromium tests passed against a production Next.js build and real loopback Supabase Auth. A disposable sender signed up, saved and reopened a draft, placed fields on two pages, sent manual links and tracked one typed and one drawn signature from separate browser sessions. The recipient downloaded the PDF. Its SHA-256 matched the sender's downloaded completion record. The sender signed out, signed back in and reopened the completed request. |
| Single home page and account controls | Sign-in and signup opened on `/`. The desktop and mobile home, password visibility, keyboard dismissal and recovery form were exercised. One disposable sender reset their password through a real Supabase Auth email captured entirely on loopback, then signed in using the new password. The team test checked the current password for a change and exercised a cross-tab inactivity sign-out. |
| Workspace teams | The owner invited a viewer, the invited account accepted on the home page, and the viewer could read documents. The owner granted sending access, then removed the account. Database tests covered wrong-email access, one-time concurrent acceptance, protected owners and expired, replaced and revoked links. |
| Touchlumo integration | The host component opened a related request, prefilled a customer, displayed the same completed state as the sender dashboard and downloaded its PDF. The CRM membership and customer service in this test was an isolated adapter. A separate contract test checked the team RPC names, caller authorization, hash-only invitation payload and workspace filters with a mocked PostgREST transport. |
| Email | A capture-only provider recorded the first invitation, the subsequent sequential invitation and all three completion notifications. Failure, retry, supersession and unavailable-email behavior stay separate from document status. No test email went to an external mailbox. |
| Visual presentation | The home page and both account controls fit within the viewport at nine phone, tablet and desktop sizes, including 320 × 568 and 568 × 320. Desktop and mobile captures verified a live WebGL scene. Pause, reduced motion, WebGL context loss and startup with WebGL disabled were checked. The CSS fallback remained visible. |
| Animated agreement detail | At a 1440 × 900 desktop viewport, the 3D canvas rendered at 2160 × 1350 on a standard screen and 2880 × 1800 at 2× pixel density. At 390 × 844 and 3× density the artwork region rendered at 1170 × 1338. Pausing froze the frame, resuming changed it, and the page fit all three viewports. [High-resolution capture](images/agreement-detail.png) |
| Hosting configuration | The two-service Blueprint passed validation against Render's official JSON Schema. The service build and start commands match the pnpm workspace packages. |

The Windows tests used the unmodified upstream GoTrue v2.169.0 binary compiled for loopback testing. The local object adapter stored test files on disk. The hosted smoke test used real Supabase Auth, PostgreSQL and the private Google Cloud Storage bucket. Provider email delivery, navigation from a live Touchlumo installation and the alternative Render deployment each need a separate test. [Google deployment](google-cloud.md) · [Render deployment](deployment.md)

[Animated landing page capture](images/lumodossier-motion.webp) · [Guided signing room](images/guided-signing.png) · [Team permissions](images/workspace-team.png) · [Completed two-recipient request](images/completed-request.png)
