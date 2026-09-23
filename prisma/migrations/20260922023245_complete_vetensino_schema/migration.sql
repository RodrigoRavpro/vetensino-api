/*
  Warnings:

  - A unique constraint covering the columns `[userId,classId]` on the table `enrollments` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('DRAFT', 'OPEN', 'FULL', 'CLOSED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ClassFormat" AS ENUM ('ONLINE', 'IN_PERSON', 'HYBRID');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'EXPIRED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'INVITED', 'ENROLLED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('ACTIVE', 'REPLACED', 'DELETED', 'UNDER_REVIEW');

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN     "classId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "classId" TEXT;

-- CreateTable
CREATE TABLE "course_classes" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'DRAFT',
    "format" "ClassFormat" NOT NULL DEFAULT 'ONLINE',
    "capacity" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "enrollmentStartsAt" TIMESTAMP(3),
    "enrollmentEndsAt" TIMESTAMP(3),
    "locationName" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "onlineUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_class_teachers" (
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_class_teachers_pkey" PRIMARY KEY ("classId","teacherId")
);

-- CreateTable
CREATE TABLE "class_schedules" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "weekday" INTEGER,
    "date" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_timeline_items" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "objectives" JSONB,
    "materials" JSONB,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_timeline_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_reservations" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT,
    "orderId" TEXT,
    "email" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seat_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "position" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_files" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "classId" TEXT,
    "lessonId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "FileStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_classes_courseId_status_idx" ON "course_classes"("courseId", "status");

-- CreateIndex
CREATE INDEX "course_classes_startsAt_idx" ON "course_classes"("startsAt");

-- CreateIndex
CREATE INDEX "course_class_teachers_teacherId_idx" ON "course_class_teachers"("teacherId");

-- CreateIndex
CREATE INDEX "class_schedules_classId_startsAt_idx" ON "class_schedules"("classId", "startsAt");

-- CreateIndex
CREATE INDEX "class_timeline_items_classId_startsAt_idx" ON "class_timeline_items"("classId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "class_timeline_items_classId_order_key" ON "class_timeline_items"("classId", "order");

-- CreateIndex
CREATE INDEX "seat_reservations_classId_status_expiresAt_idx" ON "seat_reservations"("classId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "seat_reservations_userId_classId_status_idx" ON "seat_reservations"("userId", "classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "seat_reservations_orderId_key" ON "seat_reservations"("orderId");

-- CreateIndex
CREATE INDEX "waitlist_entries_classId_status_position_idx" ON "waitlist_entries"("classId", "status", "position");

-- CreateIndex
CREATE INDEX "waitlist_entries_userId_classId_idx" ON "waitlist_entries"("userId", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_classId_position_key" ON "waitlist_entries"("classId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "course_files_storageKey_key" ON "course_files"("storageKey");

-- CreateIndex
CREATE INDEX "course_files_courseId_status_idx" ON "course_files"("courseId", "status");

-- CreateIndex
CREATE INDEX "course_files_classId_status_idx" ON "course_files"("classId", "status");

-- CreateIndex
CREATE INDEX "course_files_lessonId_status_idx" ON "course_files"("lessonId", "status");

-- CreateIndex
CREATE INDEX "course_files_uploadedById_idx" ON "course_files"("uploadedById");

-- CreateIndex
CREATE INDEX "enrollments_classId_status_idx" ON "enrollments"("classId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_userId_classId_key" ON "enrollments"("userId", "classId");

-- CreateIndex
CREATE INDEX "order_items_classId_idx" ON "order_items"("classId");

-- AddForeignKey
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_class_teachers" ADD CONSTRAINT "course_class_teachers_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_class_teachers" ADD CONSTRAINT "course_class_teachers_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_timeline_items" ADD CONSTRAINT "class_timeline_items_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_reservations" ADD CONSTRAINT "seat_reservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_files" ADD CONSTRAINT "course_files_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_files" ADD CONSTRAINT "course_files_classId_fkey" FOREIGN KEY ("classId") REFERENCES "course_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_files" ADD CONSTRAINT "course_files_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "course_lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_files" ADD CONSTRAINT "course_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
