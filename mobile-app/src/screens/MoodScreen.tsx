import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ApiError } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Button, Screen, type IconName } from '../components';
import { colors, ui } from '../theme';

type MoodEntry = { id: string; score: number; note: string; recordedOn: string; createdAt: string };
type MoodResponse = { today: string; entry: MoodEntry | null; entries: MoodEntry[] };
type LoadedMoods = MoodResponse & { timeZone: string };
type Draft = { day: string; timeZone: string; score: number | null; note: string; dirty: boolean };
const moods: { score: number; label: string; icon: IconName }[] = [
  { score: 1, label: 'Very low', icon: 'rainy-outline' },
  { score: 2, label: 'Low', icon: 'cloudy-outline' },
  { score: 3, label: 'Okay', icon: 'partly-sunny-outline' },
  { score: 4, label: 'Good', icon: 'sunny-outline' },
  { score: 5, label: 'Great', icon: 'sparkles-outline' },
];
const emptyDraft: Draft = { day: '', timeZone: '', score: null, note: '', dirty: false };

function deviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch { /* Explain a missing device time zone instead of silently using UTC. */ }
  throw new Error('Your device’s time zone could not be read. Check your date and time settings, then try again.');
}

function displayDate(day: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${day}T12:00:00Z`));
  } catch { return day; }
}

export function MoodScreen() {
  const { request } = useAuth();
  const [data, setData] = useState<LoadedMoods | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const draftRef = useRef(draft);
  const revision = useRef(0);
  const loadSequence = useRef(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const [dayConflict, setDayConflict] = useState(false);

  function replaceDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadSequence.current += 1; };
  }, []);

  const load = useCallback(async (replaceUnsaved = false) => {
    if (savingRef.current) return;
    const sequence = ++loadSequence.current;
    const startedRevision = revision.current;
    setLoading(true); setLoadError('');
    try {
      const timeZone = deviceTimeZone();
      const result = await request<MoodResponse>(`/moods?timeZone=${encodeURIComponent(timeZone)}`);
      if (!mounted.current || sequence !== loadSequence.current) return;
      setData({ ...result, timeZone });
      // A late refresh must never erase a note typed while it was in flight.
      if (revision.current === startedRevision && (!draftRef.current.dirty || replaceUnsaved)) {
        const next = { day: result.today, timeZone, score: result.entry?.score ?? null, note: result.entry?.note ?? '', dirty: false };
        draftRef.current = next;
        setDraft(next);
        setDayConflict(false); setSaveError('');
        if (replaceUnsaved) setSavedNotice('');
      }
    } catch (failure) {
      if (mounted.current && sequence === loadSequence.current) {
        setLoadError(failure instanceof Error ? failure.message : 'Your check-ins could not load. Please try again.');
      }
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [request]);

  useFocusEffect(useCallback(() => {
    void load();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    return () => { listener.remove(); };
  }, [load]));

  const changedDay = dayConflict || Boolean(data && draft.day && (data.today !== draft.day || data.timeZone !== draft.timeZone));
  const noteLength = Array.from(draft.note).length;
  const todayEntry = data?.entries.find(entry => entry.recordedOn === draft.day) ?? null;

  function edit(change: Partial<Pick<Draft, 'score' | 'note'>>) {
    revision.current += 1;
    replaceDraft({ ...draftRef.current, ...change, dirty: true });
    setSavedNotice(''); setSaveError('');
  }

  async function save() {
    const pending = draftRef.current;
    if (!pending.score || !pending.day || savingRef.current || changedDay || noteLength > 2000) return;
    savingRef.current = true;
    revision.current += 1;
    loadSequence.current += 1;
    setLoading(false); setSaving(true); setSaveError(''); setSavedNotice('');
    try {
      const { entry } = await request<{ entry: MoodEntry }>('/moods/today', {
        method: 'PUT', body: { timeZone: pending.timeZone, recordedOn: pending.day, score: pending.score, note: pending.note },
      });
      if (!mounted.current) return;
      replaceDraft({ ...pending, score: entry.score, note: entry.note, dirty: false });
      setData(previous => previous && ({ ...previous, entry,
        entries: [entry, ...previous.entries.filter(item => item.recordedOn !== entry.recordedOn)]
          .sort((a, b) => b.recordedOn.localeCompare(a.recordedOn)).slice(0, 30),
      }));
      setSavedNotice('Your check-in is saved.');
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof ApiError && failure.status === 409) setDayConflict(true);
      setSaveError(`${failure instanceof Error ? failure.message : 'Your check-in could not be saved.'} Your draft is kept.`);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <Screen>
    <View style={styles.intro}>
      <Text style={ui.eyebrow}>WITHOUT JUDGMENT</Text>
      <Text accessibilityRole="header" style={ui.title}>How are you feeling?</Text>
      <Text style={ui.body}>There’s no right answer. Make a little space for how you feel today.</Text>
    </View>

    {loading && <ActivityIndicator accessibilityLabel="Loading mood check-ins" color={colors.primary} />}
    {loadError ? <View style={ui.lavenderCard}>
      <Text accessibilityLiveRegion="polite" style={ui.body}>{loadError}</Text>
      {draft.dirty && <Text style={ui.small}>Your unsaved check-in is still here.</Text>}
      <Button label="Retry loading check-ins" secondary disabled={loading || saving} onPress={() => void load()} />
    </View> : null}

    {data && draft.day ? <View style={ui.card}>
      <View style={styles.intro}>
        <Text accessibilityRole="header" style={ui.heading}>{todayEntry ? 'Your daily check-in' : 'A moment for yourself'}</Text>
        <Text style={ui.small}>{displayDate(draft.day)} · {draft.timeZone.replaceAll('_', ' ')}</Text>
        <Text style={ui.small}>Choose the feeling that fits best. You can update today’s check-in whenever you need.</Text>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="How you feel today" style={styles.moods}>
        {moods.map(mood => <Pressable key={mood.score} accessibilityRole="radio" accessibilityLabel={mood.label}
          aria-checked={draft.score === mood.score}
          accessibilityState={{ checked: draft.score === mood.score, selected: draft.score === mood.score, disabled: saving || changedDay }}
          disabled={saving || changedDay} onPress={() => edit({ score: mood.score })}
          style={({ pressed }) => [styles.mood, draft.score === mood.score && styles.selectedMood, (pressed || saving || changedDay) && ui.dim]}>
          <Ionicons name={mood.icon} size={29} color={draft.score === mood.score ? colors.primary : colors.muted} accessible={false} aria-hidden={true} />
          <Text style={[styles.moodLabel, draft.score === mood.score && styles.selectedLabel]}>{mood.label}</Text>
        </Pressable>)}
      </View>
      <View style={styles.intro}>
        <Text style={styles.label}>Want to add a little context?</Text>
        <Text style={ui.small}>Optional. A word or a few sentences is enough.</Text>
        <TextInput accessibilityLabel="A note about your mood" placeholder="What’s been on your mind today?"
          placeholderTextColor={colors.muted} multiline textAlignVertical="top" editable={!saving && !changedDay}
          value={draft.note} onChangeText={note => edit({ note })} style={styles.note} />
        <Text style={[ui.small, noteLength > 2000 && styles.error]}>{noteLength}/2,000 characters</Text>
      </View>
      {changedDay ? <View style={styles.intro}>
        <Text accessibilityLiveRegion="polite" style={ui.body}>Your day or time zone has changed. Copy any note you want to keep, then load today’s check-in. Loading today will replace this draft.</Text>
        <Button label="Load today’s check-in" secondary disabled={loading || saving} onPress={() => void load(true)} />
      </View> : null}
      {saveError ? <Text accessibilityLiveRegion="polite" style={[ui.small, styles.error]}>{saveError}</Text> : null}
      {savedNotice ? <View style={styles.saved}><Ionicons name="checkmark-circle-outline" size={20} color={colors.teal} accessible={false} aria-hidden={true} />
        <Text accessibilityLiveRegion="polite" style={styles.savedText}>{savedNotice}</Text></View> : null}
      <Button label={saving ? 'Saving…' : todayEntry ? 'Update check-in' : 'Save check-in'} onPress={() => void save()}
        disabled={saving || changedDay || !draft.score || noteLength > 2000 || Boolean(todayEntry && !draft.dirty)} />
      <Text style={ui.small}>Saved to your account. Mood check-ins are not automatically sent to the AI assistant.</Text>
    </View> : null}

    {data ? <View style={styles.history}>
      <Text accessibilityRole="header" style={ui.heading}>Recent check-ins</Text>
      <Text style={ui.small}>Your last 30 saved check-ins. A missed day is okay.</Text>
      {data.entries.length === 0 ? <View style={ui.lavenderCard}>
        <Text style={ui.body}>Your story starts with one check-in. Your saved moods will appear here.</Text>
      </View> : data.entries.map(entry => <View key={entry.id} style={styles.historyCard}>
        <View style={styles.historyTop}>
          <Text style={styles.historyLabel}>{moods.find(mood => mood.score === entry.score)?.label ?? 'Mood check-in'}</Text>
          <Text style={ui.small}>{displayDate(entry.recordedOn)}</Text>
        </View>
        {entry.note ? <Text style={ui.body}>{entry.note}</Text> : <Text style={ui.small}>A moment to notice how you feel.</Text>}
      </View>)}
    </View> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  intro: { gap: 8 },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mood: { flex: 1, minWidth: 74, minHeight: 86, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', gap: 8 },
  selectedMood: { borderColor: colors.primary, backgroundColor: colors.lavender },
  moodLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  selectedLabel: { color: colors.primary },
  label: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  note: { minHeight: 124, padding: 15, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.background, color: colors.ink, fontSize: 16, lineHeight: 25 },
  error: { color: '#9A303B' },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedText: { color: colors.teal, fontSize: 14, lineHeight: 22, flex: 1 },
  history: { gap: 12 },
  historyCard: { ...ui.card, borderRadius: 19, padding: 20, gap: 10 },
  historyTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyLabel: { color: colors.ink, fontSize: 16, fontWeight: '600' },
});
