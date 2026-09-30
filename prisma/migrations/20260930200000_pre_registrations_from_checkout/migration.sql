CREATE TYPE "PreRegistrationSource" AS ENUM ('FORM', 'CHECKOUT');

ALTER TABLE "course_pre_registrations"
ADD COLUMN "source" "PreRegistrationSource" NOT NULL DEFAULT 'FORM',
ADD COLUMN "orderId" TEXT;

CREATE UNIQUE INDEX "course_pre_registrations_orderId_key" ON "course_pre_registrations"("orderId");

ALTER TABLE "course_pre_registrations"
ADD CONSTRAINT "course_pre_registrations_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Checkouts pendentes já existentes viram pré-inscrições (um por curso + e-mail, pedido mais recente).
INSERT INTO "course_pre_registrations" ("id", "courseId", "name", "email", "source", "orderId", "createdAt")
SELECT DISTINCT ON (items."courseId", orders."guestEmail")
    gen_random_uuid()::text,
    items."courseId",
    NULLIF(orders."guestName", ''),
    LOWER(orders."guestEmail"),
    'CHECKOUT',
    orders."id",
    orders."createdAt"
FROM "orders" AS orders
INNER JOIN "order_items" AS items ON items."orderId" = orders."id"
WHERE orders."status" = 'PENDING'
  AND orders."guestEmail" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "enrollments" AS enrollments
    INNER JOIN "users" AS users ON users."id" = enrollments."userId"
    WHERE enrollments."courseId" = items."courseId" AND users."email" = LOWER(orders."guestEmail")
  )
ORDER BY items."courseId", orders."guestEmail", orders."createdAt" DESC;
