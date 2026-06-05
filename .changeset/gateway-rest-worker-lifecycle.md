---
'@snapdragon-ai/gateway': minor
---

Expose worker adapter job lifecycle routes through the REST facade.

External workers can now acquire jobs with `POST /v1/jobs/acquire`, report
job-targeted breadcrumbs with `POST /v1/logs`, and finish leased work with
`POST /v1/jobs/:id/complete` or `POST /v1/jobs/:id/fail`.
