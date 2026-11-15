CREATE TYPE "public"."file_kind" AS ENUM('lecture_notes', 'notes', 'rubric', 'past_exam', 'other');--> statement-breakpoint
CREATE TYPE "public"."signal_stance" AS ENUM('on_exam', 'not_on_exam', 'info');--> statement-breakpoint
ALTER TABLE "exam_reports" ALTER COLUMN "topics" SET DATA TYPE text[] USING ARRAY["topics"];--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "kind" "file_kind" NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "taught_on" date;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "professor_released" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "topic" text NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "stance" "signal_stance" NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "verified_by_professor" boolean DEFAULT false NOT NULL;
