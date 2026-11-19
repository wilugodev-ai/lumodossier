# LumoDossier on Google Cloud

The dedicated testing project is `lumodossier-20261118`. Two Google Cloud Run services in `us-east1` host the website and API. The website can scale from zero to three instances and the API from zero to two. The database and Auth service run in a separate Supabase project in the eastern United States. [Open LumoDossier](https://lumodossier-web-269702414030.us-east1.run.app) · [API health](https://lumodossier-api-269702414030.us-east1.run.app/health)

| Resource | Configuration |
| --- | --- |
| `lumodossier-web` | Next.js standalone server, public HTTPS, dedicated `lumo-web` identity |
| `lumodossier-api` | NestJS, public HTTPS transport, application authorization on document and workspace endpoints |
| `lumodossier-jobs` | Private Cloud Run job using the API image and `node apps/api/dist/jobs-cli.js` |
| Cloud Scheduler | Runs the job every five minutes in UTC using `lumo-scheduler` and OAuth. That identity has `roles/run.invoker` on this job. |
| `lumodossier-20261118-documents` | Uniform access and public access prevention. The API identity has `roles/storage.objectUser` on this bucket. |
| Artifact Registry | Private Docker repository `lumo` in `us-east1`. Each build receives its own image tag. |

Cloud Run supplies the service identities used to read objects and secrets. The document API connects through the Supabase session pooler with hostname and CA verification. The dedicated database login has `NOINHERIT` and assumes `lumo_service` inside authorized transactions. PostgreSQL stores signing records, hashes and queued work. Cloud Storage holds original and completed PDFs. [Cloud Run service identity](https://docs.cloud.google.com/run/docs/securing/service-identity) · [Supabase SSL](https://supabase.com/docs/guides/platform/ssl-enforcement)

## Deploy a revision

Use the repository root and an authenticated Google Cloud CLI. `.gcloudignore` and `.dockerignore` allowlist the build inputs. Cloud Build installs the pinned pnpm dependencies and builds the selected target in `Dockerfile`. Both target images run as a non-root user.

Set `$PublishableKey` to the public Supabase publishable key. The two HTTPS origins below are the canonical addresses used for Auth redirects, CORS and private links. Use the corresponding values when deploying another project.

```powershell
$Project = 'lumodossier-20261118'
$Region = 'us-east1'
$ApiOrigin = 'https://lumodossier-api-269702414030.us-east1.run.app'
$SupabaseUrl = 'https://dkcorzeptpeqrwvvdvnw.supabase.co'
$WebSettings = "_TARGET=web,_REGION=$Region,_API_ORIGIN=$ApiOrigin,_SUPABASE_URL=$SupabaseUrl,_PUBLISHABLE_KEY=$PublishableKey"

gcloud builds submit . --project=$Project --region=$Region --config=cloudbuild.yaml --substitutions="_TARGET=api,_REGION=$Region"
gcloud builds submit . --project=$Project --region=$Region --config=cloudbuild.yaml --substitutions=$WebSettings
```

Assign each successful build ID to `$ApiBuildId` and `$WebBuildId`, then update the existing services. Updating the job as well keeps scheduled and inline processing on the same API revision.

```powershell
$Registry = "$Region-docker.pkg.dev/$Project/lumo"
gcloud run services update lumodossier-api --project=$Project --region=$Region --image="$Registry/api:$ApiBuildId"
gcloud run jobs update lumodossier-jobs --project=$Project --region=$Region --image="$Registry/api:$ApiBuildId"
gcloud run services update lumodossier-web --project=$Project --region=$Region --image="$Registry/web:$WebBuildId"
```

The web build embeds the public API origin, Supabase URL and publishable key. The API service and job receive `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `GCS_BUCKET` at runtime. They read pinned Secret Manager versions for `DATABASE_URL`, `DATABASE_CA_BASE64` and `LINK_SECRET`. Grant `roles/secretmanager.secretAccessor` on those individual secrets to `lumo-api`. The database administrator credential is reserved for migrations. [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

Run `pnpm migrate` against the isolated database with a schema-owner connection before deploying a revision that needs new migrations. Preserve the link secret across updates so issued invitations and pending email jobs continue working. The API can process work while handling requests. The scheduled job also drains the durable queue when the API has scaled to zero. [Schedule a Cloud Run job](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)

## Custom domain

Hostinger manages DNS for `lumodossier.com`. The regional Cloud Run mappings for the apex and `www.lumodossier.com` target `lumodossier-web`. The website redirects `www` to the apex and preserves the path and query. Browser signing links keep the invitation token in the URL fragment.

Google assigned the following records to these mappings. Enter each address as a separate value in Hostinger. Replace the parked apex A record and edit the existing `www` CNAME. Keep the Google ownership TXT record. In hPanel, `@` means `lumodossier.com`. [Hostinger DNS panel](https://hpanel.hostinger.com/domain/lumodossier.com/dns)

| Type | Host | Google target |
| --- | --- | --- |
| A | @ | `216.239.32.21` |
| A | @ | `216.239.34.21` |
| A | @ | `216.239.36.21` |
| A | @ | `216.239.38.21` |
| AAAA | @ | `2001:4860:4802:32::15` |
| AAAA | @ | `2001:4860:4802:34::15` |
| AAAA | @ | `2001:4860:4802:36::15` |
| AAAA | @ | `2001:4860:4802:38::15` |
| CNAME | www | `ghs.googlehosted.com` |

Once HTTPS on the apex serves the LumoDossier home page and `/health`, set `WEB_ORIGIN=https://lumodossier.com` on the API and worker. Set `PREVIOUS_WEB_ORIGIN` on the API to the original public Cloud Run web origin so already-issued private links can still access their document. In Supabase Auth, set the Site URL to the apex and allow the dashboard and password recovery URLs on both origins. [Cloud Run domain mapping](https://docs.cloud.google.com/run/docs/mapping-custom-domains)

## Accounts, invitations and Touchlumo

Supabase Auth has email confirmation enabled. Its site URL is the public Cloud Run web origin, with the dashboard and password recovery URLs allowed. Supabase's default email service sends account messages to project team addresses. Configure a verified sender in Supabase Auth SMTP to open public registration and password recovery to other addresses. [Supabase Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

Signature invitations have a separate delivery setting. The deployed API uses manual link sharing. To enable email delivery, configure `EMAIL_API_KEY` and `EMAIL_FROM` for both the API and worker, using the same HTTPS provider. A recipient can sign and download a copy through the private link without an account.

The standalone testing service uses its own Supabase issuer. The optional Touchlumo adapter is exercised with the integration suite. To connect a CRM testing deployment, configure the matching issuer, workspace permissions and the CRM's exact origin. [Touchlumo integration](touchlumo.md)

## Check a deployment

The web and API expose `/health`. The API health check queries PostgreSQL. An anonymous `GET /v1/workspaces` returns HTTP 401. For a full smoke test use a disposable confirmed sender, upload a small PDF, share its link privately and sign from a separate browser session. Download the completed document and check it using **Verify a signed copy**. A byte change must produce a mismatch.
