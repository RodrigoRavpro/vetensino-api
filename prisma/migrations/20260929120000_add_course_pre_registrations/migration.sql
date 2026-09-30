CREATE TABLE "course_pre_registrations" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_pre_registrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "course_pre_registrations_courseId_createdAt_idx" ON "course_pre_registrations"("courseId", "createdAt");
CREATE INDEX "course_pre_registrations_email_idx" ON "course_pre_registrations"("email");

ALTER TABLE "course_pre_registrations"
ADD CONSTRAINT "course_pre_registrations_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;