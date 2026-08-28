import { useMemo } from "react";

import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";
import { getMobileThemeVariables, type MobileThemeVariables } from "./mobileTheme";

/**
 * Complete JS palette for native and third-party APIs that cannot consume a
 * Uniwind className (React Navigation, native editors, Markdown, SVG gradients,
 * Reanimated worklets). Ordinary React Native rendering must use className.
 *
 * This bridge follows the appearance preference context instead of subscribing
 * every consumer to individual CSS variables. The provider applies the
 * registered Uniwind theme first, then publishes matching JS interop state.
 */
export function useUniwindTheme(): MobileThemeVariables {
  const { themeAppearance, themeId } = useAppearancePreferences();
  return useMemo(
    () => getMobileThemeVariables(themeId, themeAppearance),
    [themeAppearance, themeId],
  );
}
