import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const guardedMobileFile = createOxlintRuleHarness("t3code/no-mobile-uniwind-theme-escape-hatches", {
  filename: "apps/mobile/src/features/settings/NewThemeSurface.tsx",
});
const reviewedInteropFile = createOxlintRuleHarness(
  "t3code/no-mobile-uniwind-theme-escape-hatches",
  { filename: "apps/mobile/src/features/home/HomeHeader.tsx" },
);
const webFile = createOxlintRuleHarness("t3code/no-mobile-uniwind-theme-escape-hatches", {
  filename: "apps/web/src/ThemeSurface.tsx",
});

describe("t3code/no-mobile-uniwind-theme-escape-hatches", () => {
  guardedMobileFile.valid(
    "allows semantic mobile theme classes",
    `const surface = <View className="bg-surface text-foreground" />;`,
  );

  guardedMobileFile.valid(
    "allows unrelated functions with legacy hook names",
    `
      const useCSSVariable = () => "local value";
      const useThemeColor = () => "local color";

      export const values = [useCSSVariable(), useThemeColor()];
    `,
  );

  guardedMobileFile.valid(
    "allows unrelated imports with legacy hook names",
    `
      import { useThemeColor } from "./unrelated-library";

      export const foreground = useThemeColor();
    `,
  );

  reviewedInteropFile.valid(
    "allows reviewed native interop boundaries",
    `
      import { useUniwindTheme } from "../../lib/useUniwindTheme";

      export const foreground = useUniwindTheme().colors.foreground;
    `,
  );

  webFile.valid(
    "does not impose the mobile custom-theme policy on web code",
    `const surface = <div className="bg-white dark:bg-black" />;`,
  );

  guardedMobileFile.invalid(
    "reports new React theme subscriptions",
    `
      import { useCSSVariable } from "uniwind";

      export const foreground = useCSSVariable("--color-foreground");
    `,
    (output) => {
      assert.match(output, /semantic className/);
    },
  );

  guardedMobileFile.invalid(
    "reports the retired theme color hook",
    `
      import { useThemeColor } from "../../../hooks/useThemeColor";

      export const foreground = useThemeColor({}, "foreground");
    `,
    (output) => {
      assert.match(output, /replaced by semantic Uniwind classes/);
    },
  );

  guardedMobileFile.invalid(
    "reports unreviewed native interop subscriptions",
    `
      import { useUniwindTheme } from "../../../lib/useUniwindTheme";

      export const foreground = useUniwindTheme().colors.foreground;
    `,
    (output) => {
      assert.match(output, /native\/third-party interop boundary/);
    },
  );

  guardedMobileFile.invalid(
    "reports appearance variants in string literals",
    `const surface = <View className="bg-white dark:bg-black" />;`,
    (output) => {
      assert.match(output, /registered custom themes/);
    },
  );

  guardedMobileFile.invalid(
    "reports appearance variants in template literals",
    "const className = `bg-black light:bg-white`;",
  );

  guardedMobileFile.invalid(
    "reports negative and important appearance variants",
    `const className = "dark:-mt-2 light:!bg-white";`,
  );

  guardedMobileFile.invalid(
    "reports namespace CSS variable subscriptions",
    `
      import * as Uniwind from "uniwind";

      export const foreground = Uniwind.useCSSVariable("--color-foreground");
    `,
  );

  guardedMobileFile.invalid(
    "reports namespace access to the retired theme hook",
    `
      import * as ThemeColor from "../../../hooks/useThemeColor";

      export const foreground = ThemeColor.useThemeColor({}, "foreground");
    `,
  );
});
