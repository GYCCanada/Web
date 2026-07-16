# Custom-server deployment runbook

This runbook deploys the GYC Canada Bun application to the custom Docker host. Railway is
not part of the deployment path. The release artifact is the exact image that CI built,
booted, and smoke-tested.

## Release invariants

- Deploy `ghcr.io/gyccanada/web@sha256:...`; never deploy `latest`.
- Keep the previous known-good digest until the release is verified.
- Back up PostgreSQL and the CMS object store before a data-contract migration.
- Run migrations from the candidate image, against production configuration, before
  replacing the serving container.
- Keep secrets in the host's protected environment file. Do not put them in shell history,
  Compose files committed to the repository, or deployment logs.
- Do not reverse a database migration during rollback. Roll application traffic back while
  retaining the forward-compatible data state.

## Required inputs

```sh
export IMAGE='ghcr.io/gyccanada/web@sha256:<candidate-digest>'
export PREVIOUS_IMAGE='ghcr.io/gyccanada/web@sha256:<previous-digest>'
export ENV_FILE='/srv/gycc/env/production.env'
export NETWORK='gycc'
```

The environment file must satisfy [`.env.example`](../.env.example). Production requires
`DATABASE_URL`, every `MAIL_*` variable, and `TOAST_COOKIE_SECRET`. CMS object storage,
SendGrid, and `/admin` remain optional and are enabled only by their complete configuration
sets.

Authenticate the host to GHCR using a read-only package token, then pull both digests:

```sh
docker pull "$IMAGE"
docker pull "$PREVIOUS_IMAGE"
```

Record the candidate digest, Git commit, CI run, database backup identifier, object-store
backup identifier, operator, and deployment time in the host's deployment log.

## First-party registrar feature flag

The first-party registrar must not merge or deploy until it implements a fail-closed,
Effect-Config-backed `REGISTRAR_MODE` flag with a default of `off`:

| Mode     | New public registrations | CMS preview                | Stripe reconciliation | Order runner and sweep |
| -------- | ------------------------ | -------------------------- | --------------------- | ---------------------- |
| `off`    | disabled                 | disabled                   | disabled              | disabled               |
| `shadow` | disabled                 | enabled for administrators | disabled              | disabled               |
| `live`   | enabled                  | enabled                    | enabled               | enabled                |
| `drain`  | disabled                 | read-only                  | enabled               | enabled                |

`drain` is load-bearing: after the first Checkout Session exists, a rollback must stop new
intake without abandoning webhooks or durable Orders already in flight. Transition to `off`
only after there are no pending Orders and Stripe has no undelivered events. Public route
loaders/actions, CMS channel activation, webhook registration, runner startup, and sweep
startup must all derive from this one mode; no second boolean is allowed.

Until the first-party registrar ships, keep `REGISTRAR_MODE=off`. RegFox remains the live
Registration channel.

## Preflight and migrate

1. Confirm the candidate's main-branch CI run passed the application gate, image build,
   container smoke test, and GHCR push.
2. Complete and verify PostgreSQL and object-store backups.
3. Run the legacy Form/Submission dry run when introducing the relational store or when
   legacy objects remain to be imported:

   ```sh
   docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" \
     "$IMAGE" bun run migrate:legacy-forms --dry-run --json
   ```

4. Apply only after the report contains no rejected objects:

   ```sh
   docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" \
     "$IMAGE" bun run migrate:legacy-forms --apply --json
   ```

5. Preflight historical Form notification projections:

   ```sh
   docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" \
     "$IMAGE" bun run migrate:form-notifications --dry-run --json
   ```

6. If the report requests renamed-field mappings, create a reviewed JSON mapping outside
   the repository and mount it read-only:

   ```sh
   docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" \
     --mount type=bind,src=/srv/gycc/migrations/projection-map.json,dst=/run/projection-map.json,readonly \
     "$IMAGE" bun run migrate:form-notifications \
     --mapping /run/projection-map.json --dry-run --json
   ```

7. Apply the exact clean preflight:

   ```sh
   docker run --rm --network "$NETWORK" --env-file "$ENV_FILE" \
     --mount type=bind,src=/srv/gycc/migrations/projection-map.json,dst=/run/projection-map.json,readonly \
     "$IMAGE" bun run migrate:form-notifications \
     --mapping /run/projection-map.json --apply --json
   ```

Omit the mapping mount and `--mapping` option when no mapping is required. Save every JSON
report with the deployment record.

## Start and verify the candidate

Start the candidate beside the live container on a loopback-only port. Adapt container names,
network, and host paths to the host's existing supervisor without changing the image digest:

```sh
docker run -d --name gycc-candidate --restart unless-stopped \
  --network "$NETWORK" --env-file "$ENV_FILE" \
  -p 127.0.0.1:3001:3000 "$IMAGE"
```

Verify startup and the same public paths CI probes:

```sh
docker inspect --format '{{json .State.Health}}' gycc-candidate
curl --fail --silent --show-error http://127.0.0.1:3001/healthz
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3001/
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3001/fr
curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3001/2026/form
docker logs --tail 200 gycc-candidate
```

For a registrar-capable release, deploy first with `REGISTRAR_MODE=shadow`. Verify an
administrator can preview the published Form definition and adaptive price while anonymous
requests cannot create a Submission, Checkout Session, or Order. Change to `live` only for
the scheduled launch after Stripe webhook configuration has been verified against the
candidate endpoint.

## Cut over

1. Point the existing reverse proxy or container supervisor at the verified candidate.
2. Probe the public HTTPS `/healthz`, `/`, `/fr`, and current-conference routes.
3. Submit one non-payment form and verify its Submission and notification outbox state.
4. When the registrar is `live`, perform one Stripe test-mode registration and verify the
   immutable Form definition version, atomic Submission group, frozen Order amount, Checkout
   Session, signed webhook, and terminal Order state.
5. Watch application, PostgreSQL, mail, Stripe, and container health through the release
   observation window before removing the previous container.

## Rollback

Before any Checkout Session exists, set `REGISTRAR_MODE=off`, point traffic back to
`$PREVIOUS_IMAGE`, and repeat the health probes.

After payment intake has started, set the candidate to `REGISTRAR_MODE=drain` and keep its
webhook and Order runner reachable until every in-flight Order is terminal. Route public
traffic back to `$PREVIOUS_IMAGE` only if that image is compatible with the migrated schema.
Do not set the registrar to `off`, delete the candidate, or unregister the Stripe webhook
while an Order or Stripe event is outstanding.

Record the rollback reason and both digests. Preserve migrated data and migration reports for
the follow-up release.
