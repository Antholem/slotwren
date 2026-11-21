-- What the customer typed when booking lives on the booking: the manage page
-- and emails show it, and the public page never changes the customers row.
-- Existing bookings take their customer's current name and phone.
ALTER TABLE "bookings" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "customer_phone" text;--> statement-breakpoint
UPDATE "bookings" AS b
  SET "customer_name" = c."name", "customer_phone" = c."phone"
  FROM "customers" AS c
  WHERE c."id" = b."customer_id" AND c."business_id" = b."business_id";--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "customer_name" SET NOT NULL;--> statement-breakpoint
-- Members may correct what was typed (staff their own bookings, as RLS allows).
GRANT UPDATE ("customer_name", "customer_phone") ON public.bookings TO authenticated;
