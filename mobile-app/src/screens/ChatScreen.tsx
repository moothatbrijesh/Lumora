import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components';
import { colors, ui } from '../theme';

type Conversation = { id: string; title: string; updatedAt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type Pending = { conversationId: string; content: string; requestId: string };

export function ChatScreen() {
  const { request } = useAuth();
  const headerHeight = useHeaderHeight();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<Pending | null>(null);
  const sendingRef = useRef(false);
  const historyRef = useRef<ScrollView>(null);

  const reload = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const [status, history] = await Promise.all([
        request<{ configured: boolean }>('/chat/status'),
        request<{ conversations: Conversation[] }>('/chat/conversations'),
      ]);
      setConfigured(status.configured); setConversations(history.conversations);
    } catch { setLoadError('Chat could not load. Check your connection and try again.'); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void reload(); }, [reload]);

  async function openConversation(id: string) {
    setWorking(true); setError(''); setConfirmDelete(false);
    try {
      const result = await request<{ messages: Message[] }>(`/chat/conversations/${id}/messages`);
      setSelected(id); setMessages(result.messages); pending.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open the conversation.'); }
    finally { setWorking(false); }
  }
  async function refreshList() {
    try {
      const result = await request<{ conversations: Conversation[] }>('/chat/conversations');
      setConversations(result.conversations);
    } catch { setLoadError('Conversation list could not refresh. Your saved reply is still available.'); }
  }
  async function send() {
    const content = draft.trim();
    if (!content || sendingRef.current || !configured || Array.from(content).length > 4000) return;
    sendingRef.current = true; setSending(true); setError('');
    try {
      let id = selected;
      if (!id) {
        const result = await request<{ conversation: Conversation }>('/chat/conversations', { method: 'POST' });
        id = result.conversation.id; setSelected(id);
        setConversations(previous => [result.conversation, ...previous]);
      }
      if (!pending.current || pending.current.conversationId !== id || pending.current.content !== content) {
        pending.current = { conversationId: id, content, requestId: randomUUID() };
      }
      const result = await request<{ messages: Message[] }>(`/chat/conversations/${id}/messages`, {
        method: 'POST', body: { content, requestId: pending.current.requestId }, timeoutMs: 60000,
      });
      setMessages(previous => [...previous, ...result.messages.filter(row => !previous.some(existing => existing.id === row.id))]);
      setDraft(''); pending.current = null;
      await refreshList();
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'The reply could not be received.'} Your draft is kept. Try Send again to check for a saved reply.`);
    } finally { sendingRef.current = false; setSending(false); }
  }
  async function clearDraft() {
    setDraft(''); pending.current = null; setError('');
    // A timed-out request may have committed; reload history instead of hiding its result.
    if (selected) await openConversation(selected);
  }
  async function remove() {
    if (!selected) return;
    setWorking(true); setError('');
    try {
      await request<void>(`/chat/conversations/${selected}`, { method: 'DELETE' });
      setConversations(previous => previous.filter(row => row.id !== selected));
      setSelected(null); setMessages([]); setConfirmDelete(false); pending.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete the conversation.'); }
    finally { setWorking(false); }
  }
  const busy = loading || working || sending;
  const hasDraft = draft.length > 0;
  return <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
    <View style={styles.top}>
      <Text accessibilityRole="header" style={ui.heading}>A space to talk it through.</Text>
      <Text style={ui.small}>Messages are sent to OpenAI for replies and saved to your account. You can delete conversations.</Text>
      <ScrollView horizontal contentContainerStyle={styles.choices} showsHorizontalScrollIndicator={false}>
        <Pressable accessibilityRole="button" disabled={busy || hasDraft} onPress={() => { setSelected(null); setMessages([]); setError(''); setConfirmDelete(false); }} style={[styles.chip, !selected && styles.selected, (busy || hasDraft) && ui.dim]}>
          <Text style={styles.chipText}>New conversation</Text>
        </Pressable>
        {conversations.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Open conversation: ${item.title}`} accessibilityState={{ selected: item.id === selected, disabled: busy || hasDraft }}
          disabled={busy || hasDraft} onPress={() => void openConversation(item.id)} style={[styles.chip, item.id === selected && styles.selected, (busy || hasDraft) && ui.dim]}>
          <Text numberOfLines={1} style={styles.chipText}>{item.title}</Text>
        </Pressable>)}
      </ScrollView>
      {loading ? <ActivityIndicator accessibilityLabel="Loading conversations" color={colors.primary} /> : null}
      {loadError || !configured ? <View style={{ gap: 8 }}>
        <Text accessibilityLiveRegion="polite" style={ui.small}>{loadError || 'AI chat is not ready yet. You can still browse saved conversations.'}</Text>
        <Button label="Check chat again" onPress={() => void reload()} disabled={busy} secondary />
      </View> : null}
    </View>
    <ScrollView ref={historyRef} style={{ flex: 1 }} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" onContentSizeChange={() => historyRef.current?.scrollToEnd({ animated: false })}>
      {messages.length === 0 ? <View style={ui.lavenderCard}>
        <Text accessibilityRole="header" style={ui.heading}>What’s on your mind?</Text>
        <Text style={ui.body}>Explore a decision, find motivation, or choose one small step forward.</Text>
        {['Help me plan a manageable goal.', 'How can I make a difficult decision?'].map(prompt => <Pressable key={prompt} accessibilityRole="button" disabled={busy || !configured} onPress={() => setDraft(prompt)} style={styles.chip}><Text style={styles.chipText}>{prompt}</Text></Pressable>)}
      </View> : messages.map(message => <View key={message.id} style={[styles.bubble, message.role === 'user' && styles.userBubble]}>
        <Text style={styles.speaker}>{message.role === 'user' ? 'You' : 'Lumora · AI'}</Text>
        <Text selectable style={ui.body}>{message.content}</Text>
      </View>)}
      {sending && <View style={ui.row}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={ui.small}>Lumora is thinking…</Text></View>}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {selected && !hasDraft && !busy && <>
        {confirmDelete ? <View style={ui.card}>
          <Text style={ui.body}>Delete this conversation and its messages? This cannot be undone.</Text>
          <Button label="Delete permanently" onPress={() => void remove()} />
          <Button label="Cancel deletion" onPress={() => setConfirmDelete(false)} secondary />
        </View> : <Button label="Delete conversation" onPress={() => setConfirmDelete(true)} secondary />}
      </>}
    </ScrollView>
    <View style={styles.composer}>
      <TextInput accessibilityLabel="Message to Lumora" value={draft} onChangeText={setDraft} multiline editable={!busy && configured && !loadError}
        style={styles.input} placeholder="Share what’s on your mind…" placeholderTextColor={colors.muted} />
      <Text style={ui.small}>{Array.from(draft).length}/4000 characters</Text>
      <Button label={sending ? 'Waiting for reply…' : 'Send message'} onPress={() => void send()} disabled={busy || !configured || Boolean(loadError) || !draft.trim() || Array.from(draft.trim()).length > 4000} />
      {hasDraft && !sending && <Button label="Clear draft" onPress={() => void clearDraft()} disabled={busy} secondary />}
      {hasDraft && <Text style={ui.small}>Send or clear your draft before switching conversations.</Text>}
      <Text style={styles.disclaimer}>AI guidance can be mistaken. Not professional or emergency support.</Text>
    </View>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  top: { padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  choices: { gap: 8, paddingVertical: 2 },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 12, minHeight: 44, justifyContent: 'center', maxWidth: 260 },
  selected: { borderColor: colors.primary, backgroundColor: colors.lavender },
  chipText: { color: colors.primary, fontSize: 14, lineHeight: 20 },
  messages: { padding: 16, gap: 16, flexGrow: 1 },
  bubble: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: 16, borderRadius: 18, gap: 8, maxWidth: 640, width: '92%', alignSelf: 'flex-start' },
  userBubble: { backgroundColor: colors.lavender, alignSelf: 'flex-end' },
  speaker: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  error: { color: colors.ink, backgroundColor: colors.lavender, padding: 12, borderRadius: 12, lineHeight: 22 },
  composer: { padding: 12, gap: 6, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.ink, fontSize: 16, minHeight: 52, maxHeight: 110 },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 16 },
});
