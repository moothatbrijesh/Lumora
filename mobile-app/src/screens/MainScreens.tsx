import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../api';
import { Brand, Button, ComingSoon, Screen, type IconName } from '../components';
import { colors, ui } from '../theme';
import type { HomeProps } from '../navigation';

export function HomeScreen({ navigation }: HomeProps) {
  const { user, notice } = useAuth();
  const actions: { label: string; description: string; icon: IconName; open: () => void }[] = [
    { label: 'Check in with yourself', description: 'Explore your mood', icon: 'heart-outline', open: () => navigation.navigate('Mood') },
    { label: 'Make space to reflect', description: 'Explore your journal', icon: 'book-outline', open: () => navigation.navigate('Journal') },
    { label: 'See your journey', description: 'Explore your progress', icon: 'trending-up-outline', open: () => navigation.navigate('Progress') },
  ];
  return <Screen>
    <Brand />
    <Text style={ui.eyebrow}>YOUR SPACE TO GROW</Text>
    <Text accessibilityRole="header" style={ui.title}>Welcome, {user?.displayName}.</Text>
    <Text style={ui.body}>There’s no perfect pace. Start where you are, with one small step.</Text>
    {notice ? <Text accessibilityLiveRegion="polite" style={ui.small}>{notice}</Text> : null}
    <View style={ui.lavenderCard}>
      <Text style={ui.eyebrow}>A MOMENT OF ENCOURAGEMENT</Text>
      <Text style={[ui.heading, { fontSize: 26, lineHeight: 36 }]}>“Small steps still move you forward.”</Text>
      <Text style={ui.small}>A reminder from Lumora</Text>
    </View>
    <Text accessibilityRole="header" style={ui.heading}>Find a little clarity</Text>
    {actions.map(action => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={action.label}
      onPress={action.open} style={({ pressed }) => [ui.card, ui.row, pressed && ui.dim]}>
      <Ionicons accessible={false} aria-hidden={true} name={action.icon} size={26} color={colors.primary} />
      <View style={{ flex: 1, gap: 4 }}><Text style={[ui.heading, { fontSize: 17 }]}>{action.label}</Text><Text style={ui.small}>{action.description}</Text></View>
      <Ionicons accessible={false} aria-hidden={true} name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>)}
    <Text style={ui.small}>Your account is ready. Open Chat for a little perspective. Journaling, mood tracking, and goals are coming soon.</Text>
  </Screen>;
}

export function JournalScreen() {
  return <Screen>
    <Text style={ui.eyebrow}>ROOM FOR YOUR THOUGHTS</Text>
    <Text accessibilityRole="header" style={ui.title}>Your story, in your words.</Text>
    <Text style={ui.body}>A place to pause, notice, and make sense of your day.</Text>
    <ComingSoon icon="book-outline" title="Your journal is taking shape" description="Writing and saving entries will be available soon. No entries are displayed at this stage." />
    <View style={ui.lavenderCard}><Text accessibilityRole="header" style={ui.heading}>A prompt for today</Text><Text style={ui.body}>What gave you a small moment of peace?</Text></View>
  </Screen>;
}
export function GoalsScreen() {
  return <Screen>
    <Text style={ui.eyebrow}>ONE STEP AT A TIME</Text>
    <Text accessibilityRole="header" style={ui.title}>Grow at your own pace.</Text>
    <Text style={ui.body}>Choose what matters to you, then give yourself room to begin.</Text>
    <ComingSoon icon="flag-outline" title="Make room for a goal" description="Creating and tracking goals will be available soon. Your saved goals aren’t displayed yet." />
    <View style={ui.mintCard}><Text accessibilityRole="header" style={ui.heading}>Start small</Text><Text style={ui.body}>Think of a step you could take in ten minutes. Small and repeatable is a good place to start.</Text></View>
  </Screen>;
}
export function MoodScreen() {
  return <Screen>
    <Text style={ui.eyebrow}>WITHOUT JUDGMENT</Text>
    <Text accessibilityRole="header" style={ui.title}>How are you feeling?</Text>
    <Text style={ui.body}>There’s no right answer. Every feeling deserves a little space.</Text>
    <ComingSoon icon="heart-outline" title="Your daily check-in" description="Recording a mood and adding a note will be available soon. Nothing is being recorded on this screen yet." />
    <View style={ui.lavenderCard}><Text accessibilityRole="header" style={ui.heading}>A moment to pause</Text><Text style={ui.body}>If it feels comfortable, take a gentle breath and notice what you need right now.</Text></View>
  </Screen>;
}
export function ProgressScreen() {
  return <Screen>
    <Text style={ui.eyebrow}>NOTICE THE SMALL THINGS</Text>
    <Text accessibilityRole="header" style={ui.title}>Growth takes many forms.</Text>
    <Text style={ui.body}>Your journey is more than a number or a streak.</Text>
    <ComingSoon icon="trending-up-outline" title="Your progress, over time" description="Mood trends, journal activity, and goal progress will appear here once tracking is available. No statistics are calculated yet." />
  </Screen>;
}
export function ProfileScreen() {
  const { user, busy, notice, checkSession, logout } = useAuth();
  const [connection, setConnection] = useState('');
  const [checking, setChecking] = useState(false);
  async function checkConnection() {
    setChecking(true); setConnection('');
    try {
      const result = await api<{ status: string; database: string }>('/ready');
      if (result.status !== 'ok' || result.database !== 'connected') throw new Error('Not ready');
      setConnection('Lumora is connected and ready.');
    } catch { setConnection('Unable to connect. Check your connection and try again.'); }
    finally { setChecking(false); }
  }
  return <Screen>
    <Text style={ui.eyebrow}>YOUR LUMORA</Text>
    <Text accessibilityRole="header" style={ui.title}>A space that’s yours.</Text>
    <View style={ui.card}>
      <Ionicons accessible={false} aria-hidden={true} name="person-circle-outline" size={48} color={colors.primary} />
      <Text accessibilityRole="header" style={ui.heading}>{user?.displayName}</Text>
      <Text style={ui.body}>{user?.email}</Text>
      <Text style={ui.small}>Name and email editing will be available in a later update.</Text>
    </View>
    <View style={ui.card}>
      <Text accessibilityRole="header" style={ui.heading}>Account & connection</Text>
      <Button label="Check my session" onPress={() => void checkSession()} disabled={busy} />
      <Button label="Check connection" onPress={() => void checkConnection()} disabled={checking || busy} secondary />
      {(busy || checking) && <ActivityIndicator accessibilityLabel="Please wait" color={colors.primary} />}
      {notice ? <Text accessibilityLiveRegion="polite" style={ui.small}>{notice}</Text> : null}
      {connection ? <Text accessibilityLiveRegion="polite" style={ui.small}>{connection}</Text> : null}
      <Text style={ui.small}>{Platform.OS === 'web' ? 'Browser sign-in is not kept after a page refresh.' : 'Your session is saved securely on this device.'} Sessions expire after seven days.</Text>
      <Button label="Sign out" onPress={() => void logout()} disabled={busy || checking} secondary />
    </View>
    <ComingSoon icon="settings-outline" title="Your preferences" description="Notification and appearance settings are coming soon. No preferences can be changed yet." />
  </Screen>;
}
