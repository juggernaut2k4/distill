-- Migration 004: Phone OTP verification columns
-- Required by /api/phone/send-otp and /api/phone/verify routes

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_otp TEXT,
  ADD COLUMN IF NOT EXISTS phone_otp_expires_at TIMESTAMPTZ;
