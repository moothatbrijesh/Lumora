import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../auth/AuthProvider';
import { Button, Screen } from '../components';
import { colors, ui } from '../theme';

const faithChoices = [
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  { value: 'hindu', label: 'Hindu' },
  { value: 'sikh', label: 'Sikh' },
  { value: 'muslim', label: 'Muslim' },
  { value: 'christian', label: 'Christian' },
  { value: 'buddhist', label: 'Buddhist' },
  { value: 'jewish', label: 'Jewish' },
  { value: 'jain', label: 'Jain' },
  { value: 'spiritual', label: 'Spiritual' },
  { value: 'other', label: 'Another faith or worldview' },
  { value: 'none', label: 'No religion' },
] as const;
type Faith = typeof faithChoices[number]['value'];
type Preferences = { faith: Faith; faithEnabled: boolean };
type PreferencesResult = { preferences: Preferences };
const emptyPreferences: Preferences = { faith: 'prefer_not_to_say', faithEnabled: false };

export function PreferencesScreen() {
  const { request } = useAuth();
  const [draft, setDraft] = useState<Preferences>(emptyPreferences);
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setLoadError(''); setSaved(null); setNotice('');
    setDraft(emptyPreferences); setSaveError(''); setSaving(false); savingRef.current = false;
    try {
      const result = await request<PreferencesResult>('/preferences');
      if (generation.current !== current) return;
      setSaved(result.preferences); setDraft(result.preferences);
    } catch {
      if (generation.current === current) setLoadError('Your preferences could not load. Check your connection and try again.');
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const changed = saved !== null && (draft.faith !== saved.faith || draft.faithEnabled !== saved.faithEnabled);
  const busy = loading || saving;

  function chooseFaith(faith: Faith) {
    setDraft(previous => ({ faith, faithEnabled: faith === 'prefer_not_to_say' ? false : previous.faithEnabled }));
    setNotice(''); setSaveError('');
  }

  async function save() {
    if (!changed || !saved || loading || savingRef.current) return;
    const current = generation.current;
    savingRef.current = true; setSaving(true); setNotice(''); setSaveError('');
    try {
      const result = await request<PreferencesResult>('/preferences', { method: 'PUT', body: draft });
      if (generation.current !== current) return;
      setSaved(result.preferences); setDraft(result.preferences); setNotice('Preferences saved.');
    } catch (error) {
      if (generation.current === current) {
        setSaveError(`${error instanceof Error ? error.message : 'Your preferences could not be saved.'} Your choices are kept here. Try saving again.`);
      }
    } finally {
      if (generation.current === current) { savingRef.current = false; setSaving(false); }
    }
  }

  return <Screen>
    <Text style={ui.eyebrow}>GUIDANCE THAT RESPECTS YOU</Text>
    <Text accessibilityRole="header" style={ui.title}>Faith and worldview</Text>
    <Text style={ui.body}>This is optional. Choose what feels right for you, and decide whether it should shape your conversations.</Text>
    {loading ? <ActivityIndicator accessibilityLabel="Loading preferences" color={colors.primary} /> : null}
    {loadError ? <View style={ui.card}>
      <Text accessibilityLiveRegion="polite" style={ui.body}>{loadError}</Text>
      <Button label="Try loading preferences again" onPress={() => void load()} disabled={loading} secondary />
    </View> : null}
    {saved ? <>
      <View style={ui.card}>
        <Text accessibilityRole="header" style={ui.heading}>Your preference</Text>
        <Text style={ui.small}>You can change or clear this whenever you like. Everyone is welcome here.</Text>
        <View style={styles.choices}>
          {faithChoices.map(choice => <Pressable key={choice.value} accessibilityRole="button" accessibilityLabel={choice.label}
            aria-pressed={draft.faith === choice.value}
            accessibilityState={{ selected: draft.faith === choice.value, disabled: busy }} disabled={busy}
            onPress={() => chooseFaith(choice.value)}
            style={({ pressed }) => [styles.choice, draft.faith === choice.value && styles.selected, (pressed || busy) && ui.dim]}>
            <Ionicons accessible={false} aria-hidden={true} name={draft.faith === choice.value ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={draft.faith === choice.value ? colors.primary : colors.muted} />
            <Text style={[styles.choiceLabel, draft.faith === choice.value && styles.selectedLabel]}>{choice.label}</Text>
          </Pressable>)}
        </View>
        <Text style={ui.small}>To clear your saved choice, select “Prefer not to say” and save.</Text>
      </View>
      <View style={ui.lavenderCard}>
        <View style={ui.row}>
          <Text style={[ui.heading, { flex: 1, fontSize: 18 }]}>Use my preference in chat</Text>
          <Switch accessibilityLabel="Use my preference in chat" value={draft.faithEnabled}
            disabled={busy || draft.faith === 'prefer_not_to_say'}
            onValueChange={faithEnabled => { setDraft(previous => ({ ...previous, faithEnabled })); setNotice(''); setSaveError(''); }}
            trackColor={{ false: '#ABA5C1', true: colors.primary }} thumbColor={colors.surface} />
        </View>
        <Text style={ui.body}>When enabled, your selected preference is sent to the configured AI provider with new messages so replies can respect your beliefs or nonreligious perspective.</Text>
        <Text style={ui.small}>Turning this off applies to future replies. Existing chat history stays saved and may still include your beliefs. Start a new conversation for a fresh context.</Text>
        <Text style={ui.small}>When this is off, your saved preference is not added to new AI requests. Changes apply after you save.</Text>
      </View>
      <Button label={saving ? 'Saving preferences…' : 'Save preferences'} onPress={() => void save()} disabled={busy || !changed} />
      {changed && !saving ? <Text style={ui.small}>You have unsaved changes.</Text> : null}
      {saveError ? <Text accessibilityLiveRegion="polite" style={styles.message}>{saveError}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.message, { backgroundColor: colors.mint }]}>{notice}</Text> : null}
    </> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', flexBasis: '46%', flexGrow: 1, minWidth: 120, gap: 9, padding: 12, minHeight: 58, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface },
  selected: { backgroundColor: colors.lavender, borderColor: colors.primary },
  choiceLabel: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 21 },
  selectedLabel: { color: colors.primary, fontWeight: '600' },
  message: { color: colors.ink, backgroundColor: colors.lavender, padding: 16, borderRadius: 15, fontSize: 14, lineHeight: 23 },
});
