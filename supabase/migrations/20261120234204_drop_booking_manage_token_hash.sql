ALTER TABLE "bookings" DROP CONSTRAINT "bookings_manage_token_hash_unique";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "manage_token_hash";