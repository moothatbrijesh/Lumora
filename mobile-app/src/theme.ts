import { StyleSheet } from 'react-native';

export const colors = {
  background: '#F7F7FC', surface: '#FFFFFF', ink: '#292345', muted: '#625E75',
  primary: '#5146B9', lavender: '#EAE7F8', border: '#E8E5F1', teal: '#226C64', mint: '#E6F3EE',
};
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, gap: 22, paddingBottom: 36, width: '100%', maxWidth: 640, alignSelf: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { backgroundColor: colors.primary, width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  markText: { color: colors.surface, fontSize: 24, fontWeight: '700' },
  brand: { color: colors.ink, fontSize: 27, fontWeight: '700', letterSpacing: -1 },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  heading: { color: colors.ink, fontSize: 21, lineHeight: 29, fontWeight: '600' },
  body: { color: colors.muted, fontSize: 16, lineHeight: 25 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 24, gap: 16, borderWidth: 1, borderColor: colors.border },
  lavenderCard: { backgroundColor: colors.lavender, borderRadius: 24, padding: 24, gap: 16 },
  mintCard: { backgroundColor: colors.mint, borderRadius: 24, padding: 24, gap: 16 },
  button: { minHeight: 52, backgroundColor: colors.primary, borderRadius: 15, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  buttonText: { color: colors.surface, fontWeight: '600', fontSize: 16, textAlign: 'center' },
  secondary: { backgroundColor: colors.lavender },
  secondaryText: { color: colors.primary },
  dim: { opacity: 0.6 },
  badge: { alignSelf: 'flex-start', backgroundColor: colors.lavender, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  badgeText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 14, alignItems: 'center' },
});
