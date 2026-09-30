INSERT INTO "course_pre_registrations" ("id", "courseId", "name", "email", "phone", "company", "createdAt")
SELECT
    logs."id",
    logs."entityId",
    NULLIF(logs."payload" ->> 'name', ''),
    LOWER(logs."payload" ->> 'email'),
    NULLIF(logs."payload" ->> 'phone', ''),
    NULLIF(logs."payload" ->> 'company', ''),
    logs."createdAt"
FROM "email_logs" AS logs
INNER JOIN "courses" AS courses ON courses."id" = logs."entityId"
WHERE logs."template" = 'COURSE_PRE_REGISTRATION'
  AND logs."entityType" = 'Course'
  AND logs."payload" IS NOT NULL
  AND NULLIF(logs."payload" ->> 'email', '') IS NOT NULL
ON CONFLICT ("id") DO NOTHING;