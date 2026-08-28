import { defineRule } from "@oxlint/plugins";
import * as Option from "effect/Option";

import { getPropertyName, unwrapExpression } from "../utils.ts";

const MOBILE_SOURCE_MARKER = "/apps/mobile/src/";
const APPEARANCE_VARIANT_PATTERN = /\b(?:dark|light):(?=\S)/u;
const THEME_INTEROP_ALLOWLIST = new Set([
  "features/archive/ArchivedThreadsScreen.tsx",
  "features/connection/ConnectionsNewRouteScreen.tsx",
  "features/files/FileMarkdownPreview.tsx",
  "features/files/ThreadFilesRouteScreen.tsx",
  "features/files/thread-file-navigator-pane.tsx",
  "features/home/HomeHeader.tsx",
  "features/review/ReviewSheet.tsx",
  "features/settings/SettingsEnvironmentsRouteScreen.tsx",
  "features/settings/appearance/components/AppearancePreviews.tsx",
  "features/settings/appearance/components/FontSizeSliderRow.tsx",
  "features/threads/NewTaskContextPickerScreens.tsx",
  "features/threads/NewTaskDraftScreen.tsx",
  "features/threads/ThreadComposer.tsx",
  "features/threads/ThreadFeed.tsx",
  "features/threads/ThreadSettingsSheet.tsx",
  "features/threads/git/GitOverviewSheet.tsx",
  "features/threads/thread-list-items.tsx",
  "features/threads/thread-list-v2-items.tsx",
  "native/T3ComposerEditor.ios.tsx",
  "native/T3ComposerEditor.native.tsx",
]);

const mobileSourcePath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  const markerIndex = normalized.lastIndexOf(MOBILE_SOURCE_MARKER);
  return markerIndex === -1
    ? undefined
    : normalized.slice(markerIndex + MOBILE_SOURCE_MARKER.length);
};

const literalStringValue = (node: unknown): Option.Option<string> => {
  if (typeof node !== "object" || node === null) return Option.none();
  if (!("type" in node) || node.type !== "Literal") return Option.none();
  if (!("value" in node) || typeof node.value !== "string") return Option.none();
  return Option.some(node.value);
};

const reportsAppearanceVariant = (value: string) => APPEARANCE_VARIANT_PATTERN.test(value);

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep mobile theme styling on semantic Uniwind classes and reviewed native interop boundaries.",
    },
  },
  create(context) {
    const sourcePath = mobileSourcePath(context.filename);
    if (sourcePath === undefined) return {};

    const uniwindNamespaces = new Set<string>();
    const retiredThemeColorNamespaces = new Set<string>();

    return {
      ImportDeclaration(node) {
        const source = literalStringValue(node.source);
        if (Option.isNone(source)) return;

        for (const specifier of node.specifiers) {
          const local = unwrapExpression(specifier.local);
          const importedName =
            specifier.type === "ImportSpecifier"
              ? getPropertyName(specifier.imported)
              : Option.none();

          if (
            specifier.type === "ImportNamespaceSpecifier" &&
            Option.isSome(local) &&
            local.value.type === "Identifier"
          ) {
            if (source.value === "uniwind") uniwindNamespaces.add(local.value.name);
            if (source.value.endsWith("/useThemeColor")) {
              retiredThemeColorNamespaces.add(local.value.name);
            }
          }

          if (
            source.value === "uniwind" &&
            Option.isSome(importedName) &&
            importedName.value === "useCSSVariable"
          ) {
            context.report({
              node: specifier,
              message:
                "Use a semantic className instead of useCSSVariable; it adds a React theme subscription.",
            });
          }

          if (source.value.endsWith("/useThemeColor")) {
            context.report({
              node: specifier,
              message: "useThemeColor was replaced by semantic Uniwind classes.",
            });
          }

          if (
            source.value.endsWith("/useUniwindTheme") &&
            !THEME_INTEROP_ALLOWLIST.has(sourcePath)
          ) {
            context.report({
              node: specifier,
              message:
                "Use className for theme styling, or review and add this native/third-party interop boundary to the lint allowlist.",
            });
          }
        }
      },
      MemberExpression(node) {
        const object = unwrapExpression(node.object);
        if (Option.isNone(object) || object.value.type !== "Identifier") return;

        const property = getPropertyName(node.property);
        if (Option.isNone(property)) return;

        if (uniwindNamespaces.has(object.value.name) && property.value === "useCSSVariable") {
          context.report({
            node,
            message:
              "Use a semantic className instead of useCSSVariable; it adds a React theme subscription.",
          });
        }
        if (
          retiredThemeColorNamespaces.has(object.value.name) &&
          property.value === "useThemeColor"
        ) {
          context.report({
            node,
            message: "useThemeColor was replaced by semantic Uniwind classes.",
          });
        }
      },
      Literal(node) {
        if (typeof node.value !== "string" || !reportsAppearanceVariant(node.value)) return;
        context.report({
          node,
          message:
            "dark:/light: utilities do not follow registered custom themes; use an adaptive semantic token.",
        });
      },
      TemplateElement(node) {
        if (!reportsAppearanceVariant(node.value.raw)) return;
        context.report({
          node,
          message:
            "dark:/light: utilities do not follow registered custom themes; use an adaptive semantic token.",
        });
      },
    };
  },
});
