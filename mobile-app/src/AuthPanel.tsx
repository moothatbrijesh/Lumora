import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from './auth/AuthProvider';

export function AuthPanel() {
  const { authenticate, busy, notice, defaultMode } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(defaultMode);
  const [message, setMessage] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit() {
    if (busy) return;
    setMessage('');
    if (!email.trim() || !password || (mode === 'register' && !displayName.trim())) {
      setMessage('Please fill in all fields.'); return;
    }
    if (Array.from(password).length < 12 || Array.from(password).length > 128) {
      setMessage('Use a password of 12–128 characters.'); return;
    }
    if (mode === 'register' && password !== confirmation) {
      setMessage('Your passwords do not match.'); return;
    }
    try {
      await authenticate(mode, { email, password, ...(mode === 'register' ? { displayName } : {}) });
      setPassword(''); setConfirmation(''); setShowPassword(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Please try again.');
    }
  }

  const action = (label: string, onPress: () => void, secondary = false) => (
    <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }}
      onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, (pressed || busy) && styles.dim]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.card}>
      <>
        <Text accessibilityRole="header" style={styles.heading}>{mode === 'register' ? 'Begin your journey' : 'Welcome back'}</Text>
        <Text style={styles.body}>{mode === 'register' ? 'Create an account and take your first step.' : 'Sign in to your personal space.'}</Text>
        {mode === 'register' && <>
          <Text style={styles.label}>Your name</Text>
          <TextInput accessibilityLabel="Your name" style={styles.input} value={displayName} onChangeText={setDisplayName}
            autoComplete="name" maxLength={100} editable={!busy} placeholder="How should we call you?" placeholderTextColor="#77718A" />
        </>}
        <Text style={styles.label}>Email</Text>
        <TextInput accessibilityLabel="Email" style={styles.input} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email"
          maxLength={254} editable={!busy} placeholder="you@example.com" placeholderTextColor="#77718A" />
        <Text style={styles.label}>Password</Text>
        <TextInput accessibilityLabel="Password" style={styles.input} value={password} onChangeText={setPassword}
          secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} editable={!busy}
          placeholder="At least 12 characters" placeholderTextColor="#77718A" />
        <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          disabled={busy} onPress={() => setShowPassword(!showPassword)} style={styles.textButton}>
          <Text style={styles.link}>{showPassword ? 'Hide password' : 'Show password'}</Text>
        </Pressable>
        {mode === 'register' && <>
          <Text style={styles.hint}>Use 12–128 characters. A memorable phrase works well.</Text>
          <Text style={styles.label}>Confirm password</Text>
          <TextInput accessibilityLabel="Confirm password" style={styles.input} value={confirmation} onChangeText={setConfirmation}
            secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password"
            editable={!busy} placeholder="Enter your password again" placeholderTextColor="#77718A" />
        </>}
        {action(mode === 'register' ? 'Create account' : 'Sign in', () => void submit())}
        {action(mode === 'register' ? 'Already have an account? Sign in' : 'New to Lumora? Create account', () => {
          setMode(mode === 'register' ? 'login' : 'register'); setMessage(''); setPassword(''); setConfirmation(''); setShowPassword(false);
        }, true)}
      </>
      {busy && <ActivityIndicator accessibilityLabel="Please wait" color="#5146B9" />}
      {message || notice ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message || notice}</Text> : null}
      <Text style={styles.hint}>{Platform.OS === 'web' ? 'Browser sign-in is not kept when you refresh or close this page.' : 'Your session is stored securely on this device.'} Sessions expire after seven days.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, gap: 14, borderWidth: 1, borderColor: '#E8E5F1' },
  heading: { color: '#292345', fontSize: 26, lineHeight: 34, fontWeight: '700' },
  overline: { color: '#625794', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  body: { color: '#625E75', fontSize: 15, lineHeight: 23 },
  label: { color: '#3C3264', fontSize: 14, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#CFC9DF', borderRadius: 12, padding: 14, minHeight: 50, fontSize: 16, color: '#292345', backgroundColor: '#FBFAFE' },
  button: { backgroundColor: '#5146B9', minHeight: 50, borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#F0EDF9' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  secondaryText: { color: '#5146B9' },
  dim: { opacity: 0.65 },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  link: { color: '#5146B9', fontSize: 14, fontWeight: '600' },
  hint: { color: '#6B657F', fontSize: 12, lineHeight: 19 },
  message: { color: '#4C365D', backgroundColor: '#F0EDF9', padding: 12, borderRadius: 10, fontSize: 14, lineHeight: 21 },
});
