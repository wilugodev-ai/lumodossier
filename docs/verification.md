# Local verification

Verified on Windows on November 18, 2026 using Node 24.19.0 and pnpm 12.5.1.

| Area | Observed result |
| --- | --- |
| Static checks and production builds | ESLint, TypeScript for both apps and the API test sources, and both production builds passed. |
| API and document processing | All 16 tests passed. An isolated PostgreSQL 18 cluster exercised independent connections, concurrent recipient submissions, frozen versions, RLS, recipient assignment, role restrictions, expiring and revoked links, retries and workflow state. |
| Persistence and processing | The test stopped the actual PostgreSQL server and API, reopened the database, resumed the queued original-file write, and accessed the same request using the previously issued recipient link. Another test recovered an interrupted storage write and expired worker leases. |
| PDF placement | Poppler rendered completed values in the expected regions on cropped pages at 0°, 90°, 180° and 270°. The tests checked nondefault PDF units, deterministic output and preserved original bytes. |
| Browser workflow | Three Chromium tests passed against a production Next.js build and real loopback Supabase Auth. A disposable sender signed up, saved and reopened a draft, placed fields on two pages, sent manual links and tracked one typed and one drawn signature from separate browser sessions. The recipient downloaded the PDF. Its SHA-256 matched the sender's downloaded completion record. The sender signed out, signed back in and reopened the completed request. |
| Touchlumo integration | The host component opened a related request, prefilled a customer, displayed the same completed state as the sender dashboard and downloaded its PDF. The CRM membership and customer service in this test was an isolated adapter. |
| Email | A capture-only provider recorded the first invitation, the subsequent sequential invitation and all three completion notifications. Failure, retry, supersession and unavailable-email behavior stay separate from document status. No test email went to an external mailbox. |
| Visual presentation | Desktop and mobile captures verified a live WebGL scene. Pause, reduced motion, WebGL context loss and startup with WebGL disabled were checked. The CSS fallback remained visible. |
| Hosting configuration | The two-service Blueprint passed validation against Render's official JSON Schema. The service build and start commands match the pnpm workspace packages. |

The Windows tests used the unmodified upstream GoTrue v2.169.0 binary compiled for loopback testing. The private object adapter for automated verification was filesystem-backed. Hosted Supabase, GCS bucket IAM, a live mail provider, live Touchlumo navigation and Render URLs require verification against separately configured testing resources. [Deployment procedure](deployment.md)

[Animated landing page capture](images/lumodossier-motion.webp) · [Completed two-recipient request](images/completed-request.png)
