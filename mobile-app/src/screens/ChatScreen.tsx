import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useHeaderHeight } from '@react-navigation/elements';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components';
import { colors, ui } from '../theme';

type Conversation = { id: string; title: string; updatedAt: string };
type Message = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string };
type Pending = { conversationId: string; content: string; requestId: string };
type ChatStatus = { configured: boolean; provider: 'gemini' | 'openai' };

export function ChatScreen() {
  const { request } = useAuth();
  const headerHeight = useHeaderHeight();
  const { fontScale } = useWindowDimensions();
  // Leave room for a full scaled line plus padding and borders, even at large text sizes.
  const inputHeight = Math.max(60, Math.ceil(22 * fontScale) + 22);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<ChatStatus['provider'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [panel, setPanel] = useState<'history' | 'about'>('history');
  const [panelVisible, setPanelVisible] = useState(false);
  const pending = useRef<Pending | null>(null);
  const sendingRef = useRef(false);
  const historyRef = useRef<ScrollView>(null);
  const composerRef = useRef<TextInput>(null);

  const reload = useCallback(async () => {
    setLoading(true); setLoadError(''); setConfigured(false);
    try {
      const [status, history] = await Promise.all([
        request<ChatStatus>('/chat/status'),
        request<{ conversations: Conversation[] }>('/chat/conversations'),
      ]);
      setConfigured(status.configured); setProvider(status.provider); setConversations(history.conversations);
    } catch { setLoadError('Chat could not load. Check your connection and try again.'); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void reload(); }, [reload]);
  // Follow an actual chat update, not a resize or every content/layout change.
  // In particular, a new conversation must keep its welcome heading at the top.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (messages.length === 0 && !sending && !error) historyRef.current?.scrollTo({ y: 0, animated: false });
      else historyRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, selected, sending, error]);

  function newConversation() {
    setSelected(null); setMessages([]); setError(''); setConfirmDelete(false); setPanelVisible(false); pending.current = null;
    composerRef.current?.focus();
  }

  async function openConversation(id: string) {
    setWorking(true); setError(''); setConfirmDelete(false);
    try {
      const result = await request<{ messages: Message[] }>(`/chat/conversations/${id}/messages`);
      setSelected(id); setMessages(result.messages); setPanelVisible(false); pending.current = null;
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
    if (!content || sendingRef.current || loading || working || !configured || loadError || Array.from(content).length > 4000) return;
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
      setSelected(null); setMessages([]); setConfirmDelete(false); setPanelVisible(false); pending.current = null;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete the conversation.'); }
    finally { setWorking(false); }
  }
  const busy = loading || working || sending;
  const hasDraft = draft.length > 0;
  const draftLength = Array.from(draft).length;
  const canSend = !busy && configured && !loadError && Boolean(draft.trim()) && Array.from(draft.trim()).length <= 4000;
  const providerLabel = provider === 'gemini' ? 'Gemini (Google)' : provider === 'openai' ? 'OpenAI' : 'the configured AI provider';
  return <KeyboardAvoidingView style={[ui.screen, styles.screen]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
    <View style={styles.chat}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="New conversation" accessibilityState={{ disabled: busy || hasDraft }}
            disabled={busy || hasDraft} onPress={newConversation}
            style={({ pressed }) => [styles.newChat, (pressed || busy || hasDraft) && ui.dim]}>
            <Ionicons name="add-outline" size={20} color={colors.primary} accessible={false} aria-hidden={true} />
            <Text style={styles.actionText}>New conversation</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Conversation history" onPress={() => { setConfirmDelete(false); setPanel('history'); setPanelVisible(true); }} style={styles.iconButton}>
            <Ionicons name="time-outline" size={22} color={colors.primary} accessible={false} aria-hidden={true} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="About AI chat" onPress={() => { setPanel('about'); setPanelVisible(true); }} style={styles.iconButton}>
            <Ionicons name="information-circle-outline" size={22} color={colors.primary} accessible={false} aria-hidden={true} />
          </Pressable>
        </View>
      </View>
      <ScrollView ref={historyRef} testID="chat-history" style={styles.history} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled">
        {loading ? <ActivityIndicator accessibilityLabel="Loading conversations" color={colors.primary} /> : null}
        {!loading && (loadError || !configured) ? <View style={styles.notice}>
          <Text accessibilityLiveRegion="polite" style={ui.small}>{loadError || `AI replies are unavailable until ${providerLabel} is configured. You can write a draft or browse saved conversations.`}</Text>
          <Button label="Check chat again" onPress={() => void reload()} disabled={busy} secondary />
        </View> : null}
        {messages.length === 0 ? <View style={styles.welcome}>
          <Text accessibilityRole="header" style={ui.heading}>What’s on your mind?</Text>
          <Text style={ui.body}>Explore a decision, find motivation, or choose one small step forward.</Text>
          {['Help me plan a manageable goal.', 'How can I make a difficult decision?'].map(prompt => <Pressable key={prompt} accessibilityRole="button" disabled={busy}
            accessibilityState={{ disabled: busy }} onPress={() => { setDraft(prompt); composerRef.current?.focus(); }} style={({ pressed }) => [styles.prompt, pressed && ui.dim]}>
            <Text style={styles.chipText}>{prompt}</Text>
          </Pressable>)}
          <Text style={ui.small}>AI guidance can be mistaken. Not professional or emergency support.</Text>
        </View> : messages.map(message => <View key={message.id} style={[styles.bubble, message.role === 'user' && styles.userBubble]}>
          <Text style={styles.speaker}>{message.role === 'user' ? 'You' : 'Lumora · AI'}</Text>
          <Text selectable style={ui.body}>{message.content}</Text>
        </View>)}
        {sending && <View style={ui.row}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={ui.small}>Lumora is thinking…</Text></View>}
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View testID="chat-composer" style={styles.composer}>
        <View style={styles.composeRow}>
          <TextInput ref={composerRef} accessibilityLabel="Message to Lumora" value={draft} onChangeText={setDraft} multiline editable={!busy}
            textAlignVertical="top" scrollEnabled style={[styles.input, { height: inputHeight }]} placeholder="Share what’s on your mind…" placeholderTextColor={colors.muted} />
          <Pressable accessibilityRole="button" accessibilityLabel={sending ? 'Waiting for reply…' : 'Send message'}
            accessibilityState={{ disabled: !canSend, busy: sending }} disabled={!canSend} onPress={() => void send()}
            style={({ pressed }) => [styles.send, (pressed || !canSend) && ui.dim]}>
            {sending ? <ActivityIndicator color={colors.surface} /> : <Ionicons name="arrow-up" size={24} color={colors.surface} accessible={false} aria-hidden={true} />}
          </Pressable>
        </View>
        <View style={styles.composeMeta}>
          <Text style={[styles.counter, draftLength > 4000 && styles.overLimit]}>{draftLength}/4000 characters</Text>
          {hasDraft && !sending ? <Pressable accessibilityRole="button" accessibilityLabel="Clear draft" accessibilityState={{ disabled: busy }} disabled={busy}
            onPress={() => void clearDraft()} style={({ pressed }) => [styles.clearDraft, (pressed || busy) && ui.dim]}>
            <Text style={styles.clearLabel}>Clear draft</Text>
          </Pressable> : null}
        </View>
      </View>
    </View>
    <Modal visible={panelVisible} transparent animationType="fade" onRequestClose={() => setPanelVisible(false)}>
      <View style={styles.overlay}>
        <View style={styles.panel} accessibilityViewIsModal>
          <View style={styles.panelHeader}>
            <Text accessibilityRole="header" style={[ui.heading, { flex: 1 }]}>{panel === 'history' ? 'Conversations' : 'About AI chat'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close chat panel" onPress={() => setPanelVisible(false)} style={styles.iconButton}>
              <Ionicons name="close-outline" size={25} color={colors.ink} accessible={false} aria-hidden={true} />
            </Pressable>
          </View>
          <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent} keyboardShouldPersistTaps="handled">
            {panel === 'about' ? <>
              <Text style={ui.body}>Your message and recent conversation history go to {providerLabel} for replies. Conversations are saved to your account; you can delete them.</Text>
              {provider === 'gemini' && <Text style={ui.body}>If this project uses Gemini’s free tier, Google may use conversations to improve its products. Use fictional messages while testing.</Text>}
              <Text style={ui.small}>AI guidance can be mistaken. Not professional or emergency support.</Text>
            </> : <>
              {hasDraft && <Text style={ui.small}>Send or clear your draft before switching conversations.</Text>}
              {conversations.length === 0 ? <Text style={ui.body}>Your saved conversations will appear here.</Text> : conversations.map(item => <Pressable key={item.id}
                accessibilityRole="button" accessibilityLabel={`Open conversation: ${item.title}`} aria-pressed={item.id === selected}
                accessibilityState={{ selected: item.id === selected, disabled: busy || hasDraft }} disabled={busy || hasDraft}
                onPress={() => void openConversation(item.id)} style={({ pressed }) => [styles.conversation, item.id === selected && styles.selected, (pressed || busy || hasDraft) && ui.dim]}>
                <Text style={styles.chipText}>{item.title}</Text>
              </Pressable>)}
              {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
              {selected && !hasDraft && !busy && (confirmDelete ? <View style={styles.notice}>
                <Text style={ui.body}>Delete this conversation and its messages? This cannot be undone.</Text>
                <Button label="Delete permanently" onPress={() => void remove()} />
                <Button label="Cancel deletion" onPress={() => setConfirmDelete(false)} secondary />
              </View> : <Button label="Delete conversation" onPress={() => setConfirmDelete(true)} secondary />)}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: { minHeight: 0 },
  chat: { flex: 1, minHeight: 0, width: '100%', maxWidth: 720, alignSelf: 'center' },
  toolbar: { paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  newChat: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 14, backgroundColor: colors.lavender },
  actionText: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  history: { flex: 1, minHeight: 0 },
  messages: { padding: 12, gap: 14, flexGrow: 1 },
  welcome: { backgroundColor: colors.lavender, padding: 16, borderRadius: 20, gap: 12 },
  prompt: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 12, minHeight: 44, justifyContent: 'center' },
  conversation: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 12, minHeight: 44, justifyContent: 'center' },
  selected: { borderColor: colors.primary, backgroundColor: colors.lavender },
  chipText: { color: colors.primary, fontSize: 14, lineHeight: 20 },
  bubble: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, padding: 14, borderRadius: 18, gap: 8, width: '92%', alignSelf: 'flex-start' },
  userBubble: { backgroundColor: colors.lavender, alignSelf: 'flex-end' },
  speaker: { color: colors.primary, fontWeight: '600', fontSize: 12 },
  error: { color: colors.ink, backgroundColor: colors.lavender, padding: 12, borderRadius: 12, lineHeight: 22 },
  notice: { gap: 10 },
  composer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 16, lineHeight: 22 },
  send: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  composeMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  counter: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  overLimit: { color: '#9A303B' },
  clearDraft: { paddingHorizontal: 8, minHeight: 32, justifyContent: 'center' },
  clearLabel: { color: colors.primary, fontSize: 12, lineHeight: 18 },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'rgba(41, 35, 69, 0.35)' },
  panel: { width: '100%', maxWidth: 520, maxHeight: '85%', backgroundColor: colors.surface, borderRadius: 24, padding: 16, gap: 8 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelScroll: { flexShrink: 1 },
  panelContent: { gap: 14, paddingBottom: 8 },
});
