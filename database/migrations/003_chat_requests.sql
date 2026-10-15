-- Stable message order, even when both messages share a transaction timestamp.
ALTER TABLE chat_messages ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX chat_messages_sequence ON chat_messages(sequence);
CREATE INDEX chat_messages_conversation_sequence ON chat_messages(conversation_id, sequence);
ALTER TABLE conversations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE chat_requests (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  content_hash text NOT NULL,
  user_message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  assistant_message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, request_id)
);
