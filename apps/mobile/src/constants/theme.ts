/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * The studio's palette (apps/studio globals.css), converted from oklch.
 * Same three rules apply here: no corner radius, no shadows, warm ground and
 * warm ink — day is paper, night is brown-black ink, never #000. The accent
 * is oxblood by day and terracotta by night.
 */
export const Colors = {
  light: {
    text: '#1D1916',
    background: '#F9F6F1',
    backgroundElement: '#F1EDE6',
    backgroundSelected: '#E9E4DA',
    textSecondary: '#69625B',
    card: '#FEFCF8',
    primary: '#622015',
    primaryForeground: '#FCFAF6',
    border: '#DDD8D0',
    input: '#D9D3CA',
    destructive: '#8F3126',
  },
  dark: {
    text: '#EAE6DC',
    background: '#15120F',
    backgroundElement: '#272320',
    backgroundSelected: '#312B27',
    textSecondary: '#9F9990',
    card: '#1F1B18',
    primary: '#CF8D60',
    primaryForeground: '#17130F',
    border: '#3A3631',
    input: '#413C38',
    destructive: '#CA564B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
