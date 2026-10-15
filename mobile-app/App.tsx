import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthPanel } from './src/AuthPanel';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { AppNavigation } from './src/navigation';
import { Brand, Button, Screen } from './src/components';
import { colors, ui } from './src/theme';

function Root() {
  const { user, restoring, restoreFailed, notice, restore } = useAuth();
  if (restoring || restoreFailed) return <SafeAreaView style={ui.screen}><View style={ui.content}>
    <Brand />
    {restoring ? <ActivityIndicator accessibilityLabel="Restoring session" color={colors.primary} /> : <>
      <Text accessibilityRole="header" style={ui.title}>Let’s reconnect</Text>
      <Text style={ui.body}>{notice}</Text>
      <Button label="Retry connection" onPress={() => void restore()} />
    </>}
  </View></SafeAreaView>;
  // Removing the navigator on logout/expiry prevents Back reopening signed-in screens.
  if (user) return <AppNavigation key={user.id} />;
  return <SafeAreaView style={ui.screen}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <Brand />
        <Text style={ui.eyebrow}>A LITTLE CLARITY, EVERY DAY</Text>
        <Text accessibilityRole="header" style={ui.title}>Make space for your growth.</Text>
        <Text style={ui.body}>Your journey is your own. Find direction and move forward at your pace.</Text>
        <AuthPanel />
        <Text style={[ui.small, { textAlign: 'center' }]}>A supportive space for every background and belief.</Text>
      </Screen>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export default function App() {
  return <SafeAreaProvider><StatusBar style="dark" /><AuthProvider><Root /></AuthProvider></SafeAreaProvider>;
}
