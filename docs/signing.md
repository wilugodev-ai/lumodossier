# Signing, storage and evidence

## What a signature records

A recipient invitation proves possession of a private link. It works without an account. Anyone to whom the link is forwarded may use it until it expires or is revoked. The named recipient supplies a typed or drawn signature and explicitly agrees to the displayed consent wording and intent statement. LumoDossier stores those exact statements, consent version, recipient identity supplied by the sender, method of access, request and version identifiers, values and server-generated timestamps.

The completed PDF paints the submitted values onto the frozen original using normalized displayed-page coordinates. Preserve the original file and the downloaded completion record with the signed copy. SHA-256 hashes in the record identify both byte streams. This is an ordinary electronic-signature workflow. Its evidence does not include identity-document verification, notarization, an independent timestamp authority or a certificate-based digital signature.

## Verify a downloaded copy

Open **Verify a signed copy** in the recipient’s completed agreement or the sender’s **Document files** panel. Choose the downloaded PDF. The browser retrieves the authorized completion record for that agreement, hashes the selected file locally with SHA-256 and compares the two hashes. An exact match confirms the file is byte-for-byte identical to the recorded signed PDF. The file picker keeps the selected document on the device. Each recipient also sees their own signature timestamp and, after completion, the agreement’s completion time.

[See the guided signing room](images/guided-signing.png)

## Private storage and authorization

PDFs are validated and staged in private PostgreSQL byte arrays in the same transaction as their storage jobs. A worker writes the object to a deterministic private bucket key with a create-only generation precondition, verifies an existing object after an interrupted retry, and removes the database staging copy after confirmation. A completed request is published only after the signed PDF has been stored. The application never issues public object URLs. It authorizes each preview and download, verifies the bytes against their recorded hashes, then sends them with private no-store response headers.

The `lumo` schema has RLS and an internal `lumo_service` role. Use a dedicated, non-owner runtime login with `NOINHERIT NOBYPASSRLS`. Sender transactions select the verified workspace scope and check the sender's current membership. Recipient transactions authenticate a hashed bearer, lock the request and check its current deadline, status, assigned person and routing order. Database locks and a unique request/recipient signature key serialize concurrent submissions. Retrying an identical signed submission returns its receipt while that link is valid. A changed submission is rejected.

Tokens use a secret-keyed HMAC of a random invitation identifier. PostgreSQL stores the SHA-256 digest used for lookup and the nonsecret invitation identifier. The server uses the identifier and the independently stored secret to reconstruct the email link during a retry. A database dump alone does not reveal the raw bearer. Rotating the link secret invalidates token reconstruction for pending mail. To invalidate already-issued links as part of a compromise response, also revoke the relevant invitation rows and issue replacements. Newly issued completion links last 30 days. Ordinary signing links retain their original deadlines.

Recipient URLs put the bearer in the fragment. The browser sends it to a fixed API path in an authorization header. Document titles, tokens and email bodies are excluded from application logs. Use equivalent redaction in any external proxy, observability and provider tooling. The API rate-limits public access with hashed, minute-bucket counters in PostgreSQL.

## Audit integrity and administrative limits

The runtime role can insert and read events, signatures and email attempts. It cannot update or delete those records. Request guards freeze the source, version, recipients, fields, routing and deadline after sending. New request creation is the supported path for revisions. Signing history is assembled from database events and per-recipient state.

Database owners and infrastructure administrators can alter databases, disable triggers, restore backups or replace stored files. The application checks hashes on reads, but administrators with access to both files and the database can replace both. Protect database backups, restrict GCS IAM, and set retention for the organization. External mail providers receive the recipient address and invitation link.

## Delivery and recovery

The database stores jobs for original-file storage, final PDF processing, expiration, invitation mail, reminders and completion notifications. Workers use row locks with `SKIP LOCKED`, a two-minute lease, an idempotency key per logical mail, bounded exponential retry delays and at most seven claims per run of a job. Stale leases recover after restart. Concurrent finalizers reuse the staged output and record completion under the request lock.

File processing that exhausts retries leaves the private staging data in place. Fix the storage or worker configuration, then choose **Retry file processing** on the request. Draft storage can also be retried with `POST /v1/workspaces/:workspace/documents/:id/retry-files`. The worker removes the staging bytes after a successful private object write. Reissuing a reminder creates its own delivery attempt. The provider's idempotency retention determines its behavior after a prolonged ambiguous network failure.

Email activity shows **queued**, **accepted by provider**, **failed**, **superseded** or **email not sent**. Individual provider attempts have their own timestamps. Delivery to the recipient's inbox requires independent provider evidence. Without provider credentials, eligible recipients can use manual sharing links. Copy links expire and can be replaced or revoked after completion.

Request status is derived in PostgreSQL. A deadline is enforced even while workers are asleep. Once the final recipient has validly signed, the request stays sealed during PDF processing. It moves to completed after private storage succeeds. Requests that are cancelled, expired or declined cannot collect further signatures.
