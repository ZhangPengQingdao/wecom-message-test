-- Create the messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content TEXT NOT NULL,
  sender TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create an index on created_at for faster retrieval of recent messages
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows anyone to insert messages (since the bot will use the API)
-- In a production environment, you might want to restrict this to authenticated users or using a service role key.
-- For this simple example, we'll allow public insert but you should secure your API endpoint.
CREATE POLICY "Enable insert for everyone" ON messages FOR INSERT WITH CHECK (true);

-- Create a policy that allows reading messages (you might want to restrict this)
CREATE POLICY "Enable read for everyone" ON messages FOR SELECT USING (true);
