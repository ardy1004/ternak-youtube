-- Jam dasar + pergeseran harian (menggantikan jendela + jitter).
--
-- DITULIS TANGAN, menggantikan keluaran drizzle-kit yang membangun ulang
-- seluruh tabel. Rebuild itu gagal karena dua sebab sekaligus:
--   1. INSERT ... SELECT-nya mengambil base_times/drift_* DARI tabel lama,
--      padahal kolom itu justru yang sedang ditambahkan.
--   2. DROP TABLE channels melanggar foreign key dari video_assets dan
--      scheduled_posts; D1 tidak menghormati PRAGMA foreign_keys=OFF di dalam
--      migrasi.
--
-- Menambah kolom cukup dengan ALTER TABLE: data lama utuh, tidak ada tabel
-- yang dijatuhkan, tidak ada foreign key yang tersentuh.

ALTER TABLE `channels` ADD COLUMN `base_times` text DEFAULT '06:00,12:00,17:00,19:00,21:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD COLUMN `drift_minutes_per_day` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `channels` ADD COLUMN `drift_anchor_date` text;--> statement-breakpoint

-- Channel yang sudah ada memulai siklusnya hari ini, jadi hari pertama setelah
-- migrasi memakai jam dasar apa adanya.
UPDATE `channels` SET `drift_anchor_date` = date('now') WHERE `drift_anchor_date` IS NULL;--> statement-breakpoint

-- Kuota harian efektif yang dikonfirmasi operator: 5 upload/hari.
UPDATE `channels` SET `max_uploads_per_day` = 5 WHERE `max_uploads_per_day` < 5;--> statement-breakpoint
UPDATE `channels` SET `videos_per_day` = 5 WHERE `videos_per_day` < 5;
