# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Keyboard handling — project convention

Interaction quality is a core requirement of this app. Never use React Native's
`KeyboardAvoidingView` or the deprecated `useAnimatedKeyboard` — always use
`react-native-keyboard-controller` (https://kirillzyusko.github.io/react-native-keyboard-controller/):
its components track the keyboard frame natively, so content moves in sync with
the keyboard's own animation curve instead of jumping.

- `KeyboardProvider` is mounted once in `src/app/_layout.tsx`; don't add another.
- Simple forms: `KeyboardAvoidingView` from this library (`behavior="padding"`).
- Scrollable forms: `KeyboardAwareScrollView`. Chat-like composers: `KeyboardStickyView`.
- It is a native module: after first adding it (or bumping it), the EAS dev
  client must be rebuilt (`eas build --profile development-simulator --platform ios`).
