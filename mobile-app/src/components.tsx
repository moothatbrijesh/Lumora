import { Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { colors, ui } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Brand() {
  return <View style={ui.brandRow}><View style={ui.mark}><Text style={ui.markText}>L</Text></View><Text style={ui.brand}>lumora</Text></View>;
}
export function Screen({ children }: { children: ReactNode }) {
  return <ScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
}
export function Button({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [ui.button, secondary && ui.secondary, (pressed || disabled) && ui.dim]}>
    <Text style={[ui.buttonText, secondary && ui.secondaryText]}>{label}</Text>
  </Pressable>;
}
export function ComingSoon({ title, description, icon }: { title: string; description: string; icon: IconName }) {
  return <View style={ui.card}>
    <Ionicons name={icon} size={32} color={colors.primary} accessible={false} aria-hidden={true} />
    <View style={ui.badge}><Text style={ui.badgeText}>Coming soon</Text></View>
    <Text accessibilityRole="header" style={ui.heading}>{title}</Text>
    <Text style={ui.body}>{description}</Text>
  </View>;
}
