CREATE TYPE "ManualPaymentMethod" AS ENUM ('PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'BANK_TRANSFER', 'CASH', 'OTHER');

ALTER TABLE "course_pre_registrations" ADD COLUMN "convertedAt" TIMESTAMP(3);

CREATE TABLE "enrollment_agreements" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "preRegistrationId" TEXT,
    "negotiatedPrice" DECIMAL(10,2) NOT NULL,
    "paymentMethod" "ManualPaymentMethod" NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "amountPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enrollment_documents" (
    "id" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enrollment_agreements_enrollmentId_key" ON "enrollment_agreements"("enrollmentId");
CREATE UNIQUE INDEX "enrollment_agreements_preRegistrationId_key" ON "enrollment_agreements"("preRegistrationId");
CREATE INDEX "enrollment_agreements_createdById_idx" ON "enrollment_agreements"("createdById");
CREATE UNIQUE INDEX "enrollment_documents_storageKey_key" ON "enrollment_documents"("storageKey");
CREATE INDEX "enrollment_documents_agreementId_idx" ON "enrollment_documents"("agreementId");
CREATE INDEX "enrollment_documents_uploadedById_idx" ON "enrollment_documents"("uploadedById");

ALTER TABLE "enrollment_agreements" ADD CONSTRAINT "enrollment_agreements_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrollment_agreements" ADD CONSTRAINT "enrollment_agreements_preRegistrationId_fkey" FOREIGN KEY ("preRegistrationId") REFERENCES "course_pre_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollment_agreements" ADD CONSTRAINT "enrollment_agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollment_documents" ADD CONSTRAINT "enrollment_documents_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "enrollment_agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrollment_documents" ADD CONSTRAINT "enrollment_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
