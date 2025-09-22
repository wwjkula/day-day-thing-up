-- CreateEnum
CREATE TYPE "public"."Scope" AS ENUM ('self', 'direct', 'subtree');

-- CreateTable
CREATE TABLE "public"."org_units" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_id" BIGINT,
    "type" VARCHAR(20) NOT NULL DEFAULT 'department',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "org_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" BIGSERIAL NOT NULL,
    "employee_no" VARCHAR(50),
    "name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(120),
    "phone" VARCHAR(30),
    "job_title" VARCHAR(100),
    "grade" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_org_memberships" (
    "userId" BIGINT NOT NULL,
    "orgId" BIGINT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE NOT NULL,
    "end_date" DATE,

    CONSTRAINT "user_org_memberships_pkey" PRIMARY KEY ("userId","orgId","start_date")
);

-- CreateTable
CREATE TABLE "public"."manager_edges" (
    "manager_id" BIGINT NOT NULL,
    "subordinate_id" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "priority" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "manager_edges_pkey" PRIMARY KEY ("manager_id","subordinate_id","start_date")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" BIGSERIAL NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_grants" (
    "id" BIGSERIAL NOT NULL,
    "grantee_user_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "domain_org_id" BIGINT NOT NULL,
    "scope" "public"."Scope" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,

    CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."work_items" (
    "id" BIGSERIAL NOT NULL,
    "creator_id" BIGINT NOT NULL,
    "org_id" BIGINT NOT NULL,
    "work_date" DATE NOT NULL,
    "title" VARCHAR(40) NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'done',
    "duration_minutes" INTEGER,
    "tags" VARCHAR(200),
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attachments" (
    "id" BIGSERIAL NOT NULL,
    "work_item_id" BIGINT NOT NULL,
    "file_name" VARCHAR(255),
    "mime" VARCHAR(100),
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "stored_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" BIGINT NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "object_type" VARCHAR(50),
    "object_id" BIGINT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_no_key" ON "public"."users"("employee_no");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "public"."roles"("code");

-- AddForeignKey
ALTER TABLE "public"."org_units" ADD CONSTRAINT "org_units_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_org_memberships" ADD CONSTRAINT "user_org_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_org_memberships" ADD CONSTRAINT "user_org_memberships_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manager_edges" ADD CONSTRAINT "manager_edges_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."manager_edges" ADD CONSTRAINT "manager_edges_subordinate_id_fkey" FOREIGN KEY ("subordinate_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_grants" ADD CONSTRAINT "role_grants_grantee_user_id_fkey" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_grants" ADD CONSTRAINT "role_grants_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_grants" ADD CONSTRAINT "role_grants_domain_org_id_fkey" FOREIGN KEY ("domain_org_id") REFERENCES "public"."org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."work_items" ADD CONSTRAINT "work_items_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."work_items" ADD CONSTRAINT "work_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."org_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attachments" ADD CONSTRAINT "attachments_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
