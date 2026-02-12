-- Create the tickets table
CREATE TABLE IF NOT EXISTS tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  report_time TEXT,
  reporter TEXT,
  department TEXT,
  arrival_time TEXT,
  location TEXT,
  problem TEXT,
  reason TEXT,
  solution TEXT,
  fix_time TEXT,
  is_fixed TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Allow insert and read for everyone (for demo simplicity)
CREATE POLICY "Enable insert for everyone" ON tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable read for everyone" ON tickets FOR SELECT USING (true);
