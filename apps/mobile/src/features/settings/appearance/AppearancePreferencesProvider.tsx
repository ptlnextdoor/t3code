import {
  createContext,
  startTransition,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Appearance, useColorScheme } from "react-native";

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { Uniwind } from "uniwind";

import {
  resolveAppearance,
  resolveAppearancePreferences,
  type ResolvedAppearance,
} from "../../../lib/appearancePreferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import type { Preferences } from "../../../persistence/mobile-preferences";
import {
  createMobileThemePairPatch,
  createMobileThemeSelectionPatch,
  normalizeMobileThemeMode,
  resolveMobileThemeIds,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeIds,
  type MobileThemeMode,
} from "../../../lib/mobileTheme";
import {
  createMobileThemeRuntimeOperations,
  type MobileThemeRuntimeState,
} from "../../../lib/mobileThemeRuntime";
import { cacheTerminalFontSize } from "../../terminal/terminalUiState";

interface AppearancePreferencesContextValue {
  /** Effective values with base-size derivation applied. Use this for rendering. */
  readonly appearance: ResolvedAppearance;
  readonly themeId: MobileThemeId;
  readonly themeIds: MobileThemeIds;
  readonly themeMode: MobileThemeMode;
  readonly themeAppearance: MobileThemeAppearance;
  readonly isReady: boolean;
  readonly setThemeIdForAppearance: (
    appearance: MobileThemeAppearance,
    value: MobileThemeId,
  ) => void;
  readonly setThemeIdForBothAppearances: (value: MobileThemeId) => void;
  readonly setThemeMode: (value: MobileThemeMode) => void;
  readonly setBaseFontSize: (value: number) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setTerminalFontSize: (value: number | null) => void;
  /** Pass null to clear the override and follow the base font size. */
  readonly setCodeFontSize: (value: number | null) => void;
  readonly setCodeWordBreak: (value: boolean) => void;
}

const AppearancePreferencesContext = createContext<AppearancePreferencesContextValue | null>(null);

export function AppearancePreferencesProvider(props: { readonly children: ReactNode }) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const systemColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const storedPreferences = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value
    : null;
  const preferences = useMemo(
    () => resolveAppearancePreferences(storedPreferences),
    [storedPreferences],
  );
  const themeMode = normalizeMobileThemeMode(storedPreferences?.themeMode);
  const themeAppearance = themeMode === "system" ? systemColorScheme : themeMode;
  const themeIds = useMemo(
    () => resolveMobileThemeIds(storedPreferences ?? {}),
    [storedPreferences],
  );
  const themeId = themeIds[themeAppearance];
  // Preference patches are optimistic. Keep controls interactive while a save is
  // in flight so rapid theme choices can supersede one another immediately.
  const isReady = AsyncResult.isSuccess(preferencesResult);
  const runtimeState = useMemo<MobileThemeRuntimeState>(
    () => ({
      baseFontSize: preferences.baseFontSize,
      themeAppearance,
      themeIds,
      themeMode,
    }),
    [preferences.baseFontSize, themeAppearance, themeIds, themeMode],
  );
  const appliedRuntimeStateRef = useRef<MobileThemeRuntimeState | null>(null);

  const applyThemeRuntime = useCallback((next: MobileThemeRuntimeState) => {
    const operations = createMobileThemeRuntimeOperations(appliedRuntimeStateRef.current, next);
    for (const operation of operations) {
      if (operation.kind === "update-text-variables") {
        Uniwind.updateCSSVariables(operation.themeName, operation.variables);
        continue;
      }
      if (operation.kind === "set-appearance-mode") {
        Appearance.setColorScheme(
          operation.themeMode === "system" ? "unspecified" : operation.appearance,
        );
        continue;
      }
      Uniwind.setTheme(operation.themeName);
      // A custom Uniwind theme resets React Native's appearance override to
      // `unspecified`. Restore it in the same event so native-stack headers,
      // form-sheet chrome, and system controls cannot land one frame later on
      // the opposite appearance.
      Appearance.setColorScheme(
        operation.themeMode === "system" ? "unspecified" : operation.appearance,
      );
    }
    appliedRuntimeStateRef.current = next;
  }, []);

  const syncThemeRuntime = useCallback(
    (next: MobileThemeRuntimeState) => applyThemeRuntime(next),
    [applyThemeRuntime],
  );

  const updatePreferences = useCallback(
    (patch: Partial<Preferences>) => {
      startTransition(() => savePreferences(patch));
    },
    [savePreferences],
  );

  useLayoutEffect(() => {
    syncThemeRuntime(runtimeState);
    cacheTerminalFontSize(resolveAppearance(preferences).terminalFontSize);
  }, [preferences, runtimeState, syncThemeRuntime]);

  const setThemeIdForAppearance = useCallback(
    (appearance: MobileThemeAppearance, value: MobileThemeId) => {
      const current = appliedRuntimeStateRef.current ?? runtimeState;
      const patch = createMobileThemeSelectionPatch(
        current.themeIds,
        current.themeAppearance,
        appearance,
        value,
      );
      syncThemeRuntime({
        ...current,
        themeIds: resolveMobileThemeIds(patch),
      });
      updatePreferences(patch);
    },
    [runtimeState, syncThemeRuntime, updatePreferences],
  );

  const setThemeIdForBothAppearances = useCallback(
    (value: MobileThemeId) => {
      const current = appliedRuntimeStateRef.current ?? runtimeState;
      const patch = createMobileThemePairPatch(value);
      syncThemeRuntime({
        ...current,
        themeIds: resolveMobileThemeIds(patch),
      });
      updatePreferences(patch);
    },
    [runtimeState, syncThemeRuntime, updatePreferences],
  );

  const setThemeMode = useCallback(
    (value: MobileThemeMode) => {
      const current = appliedRuntimeStateRef.current ?? runtimeState;

      // React Native caches an app override in Appearance.getColorScheme().
      // Clear it first so System mode reads the device preference before the
      // matching registered Uniwind theme is applied in this same event.
      if (value === "system") Appearance.setColorScheme("unspecified");
      const nextAppearance =
        value === "system" ? (Appearance.getColorScheme() === "dark" ? "dark" : "light") : value;
      syncThemeRuntime({
        ...current,
        themeAppearance: nextAppearance,
        themeMode: value,
      });
      updatePreferences({ themeMode: value });
    },
    [runtimeState, syncThemeRuntime, updatePreferences],
  );

  const setBaseFontSize = useCallback(
    (value: number) => {
      const current = appliedRuntimeStateRef.current ?? runtimeState;
      syncThemeRuntime({ ...current, baseFontSize: value });
      updatePreferences({ baseFontSize: value });
    },
    [runtimeState, syncThemeRuntime, updatePreferences],
  );

  const setTerminalFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ terminalFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeFontSize = useCallback(
    (value: number | null) => {
      updatePreferences({ codeFontSize: value });
    },
    [updatePreferences],
  );

  const setCodeWordBreak = useCallback(
    (value: boolean) => {
      updatePreferences({ codeWordBreak: value });
    },
    [updatePreferences],
  );

  const value = useMemo(
    (): AppearancePreferencesContextValue => ({
      appearance: resolveAppearance(preferences),
      themeId,
      themeIds,
      themeMode,
      themeAppearance,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
    }),
    [
      preferences,
      themeId,
      themeIds,
      themeMode,
      themeAppearance,
      isReady,
      setThemeIdForAppearance,
      setThemeIdForBothAppearances,
      setThemeMode,
      setBaseFontSize,
      setTerminalFontSize,
      setCodeFontSize,
      setCodeWordBreak,
    ],
  );

  return (
    <AppearancePreferencesContext.Provider value={value}>
      {props.children}
    </AppearancePreferencesContext.Provider>
  );
}

export function useAppearancePreferences(): AppearancePreferencesContextValue {
  const context = use(AppearancePreferencesContext);
  if (!context) {
    throw new Error("useAppearancePreferences must be used within AppearancePreferencesProvider");
  }
  return context;
}
