import { DefaultTheme, NavigationContainer, type CompositeScreenProps } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from './theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen, ChatScreen, JournalScreen, GoalsScreen, ProfileScreen, MoodScreen, ProgressScreen } from './screens/MainScreens';
import type { IconName } from './components';

export type RootRoutes = { Main: undefined; Mood: undefined; Progress: undefined };
export type TabRoutes = { Home: undefined; Chat: undefined; Journal: undefined; Goals: undefined; Profile: undefined };
export type HomeProps = CompositeScreenProps<BottomTabScreenProps<TabRoutes, 'Home'>, NativeStackScreenProps<RootRoutes>>;
const Tab = createBottomTabNavigator<TabRoutes>();
const Stack = createNativeStackNavigator<RootRoutes>();
const icons: Record<keyof TabRoutes, IconName> = {
  Home: 'home-outline', Chat: 'chatbubble-ellipses-outline', Journal: 'book-outline', Goals: 'flag-outline', Profile: 'person-circle-outline',
};
function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);
  return <Tab.Navigator backBehavior="history" screenOptions={({ route }) => ({
    headerShown: true, tabBarAccessibilityLabel: route.name,
    headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.ink,
    headerShadowVisible: false,
    tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.muted,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64 + bottomPadding, paddingBottom: bottomPadding, paddingTop: 8 },
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' }, tabBarHideOnKeyboard: true,
    tabBarIcon: ({ color, size }) => <Ionicons accessible={false} aria-hidden={true} name={icons[route.name]} color={color} size={size} />,
  })}>
    <Tab.Screen name="Home" component={HomeScreen} />
    <Tab.Screen name="Chat" component={ChatScreen} />
    <Tab.Screen name="Journal" component={JournalScreen} />
    <Tab.Screen name="Goals" component={GoalsScreen} />
    <Tab.Screen name="Profile" component={ProfileScreen} />
  </Tab.Navigator>;
}
export function AppNavigation() {
  return <NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors,
    primary: colors.primary, background: colors.background, card: colors.surface, text: colors.ink, border: colors.border } }}>
    <Stack.Navigator screenOptions={{ headerBackTitle: 'Home', headerTintColor: colors.primary, headerStyle: { backgroundColor: colors.background }, headerShadowVisible: false }}>
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="Mood" component={MoodScreen} options={{ title: 'Mood check-in' }} />
      <Stack.Screen name="Progress" component={ProgressScreen} options={{ title: 'Your progress' }} />
    </Stack.Navigator>
  </NavigationContainer>;
}
