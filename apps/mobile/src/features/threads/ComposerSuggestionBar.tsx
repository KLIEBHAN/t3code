// Fork: touch-friendly prompt-suggestion bar rendered directly above the mobile composer.
import * as Haptics from "expo-haptics";
import { Platform, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { formatSuggestionPreview } from "./composerSuggestions";

const BAR_ENTERING = FadeIn.duration(150).reduceMotion(ReduceMotion.System);
const BAR_EXITING = FadeOut.duration(110).reduceMotion(ReduceMotion.System);

export interface ComposerSuggestionBarProps {
  readonly draft: string;
  readonly suggestion: string | null;
  readonly hasNextWord: boolean;
  readonly pending: boolean;
  readonly alternativeIndex: number | null;
  readonly alternativeCount: number;
  readonly onAcceptAll: () => void;
  readonly onAcceptNextWord: () => void;
  readonly onCycle: () => void;
  readonly onRefresh: () => void;
  readonly onDismiss: () => void;
}

/* oxlint-disable t3code/no-untranslated-copy -- fork text stays English */
export function ComposerSuggestionBar(props: ComposerSuggestionBarProps) {
  const preview = formatSuggestionPreview(props.draft, props.suggestion);
  if (preview === null && !props.pending) return null;

  const showWordAction = preview !== null && props.hasNextWord && !props.pending;
  const altLabel =
    props.alternativeIndex !== null && props.alternativeCount > 1 && !props.pending
      ? `${props.alternativeIndex + 1}/${props.alternativeCount}`
      : null;

  const content = (
    <View className="min-h-[40px] flex-row items-center gap-1 py-1 pl-3 pr-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={preview === null ? "Loading suggestions" : "Accept suggestion"}
        disabled={preview === null}
        onPress={() => {
          void Haptics.selectionAsync();
          props.onAcceptAll();
        }}
        className="min-w-0 flex-1 py-1 pr-1 active:opacity-65"
      >
        {preview === null ? (
          <Text textRole="footnote" numberOfLines={1} className="text-foreground-muted">
            Loading suggestions…
          </Text>
        ) : (
          <Text textRole="footnote" numberOfLines={2} ellipsizeMode="tail">
            {preview.prefix.length > 0 ? (
              <Text textRole="footnote" className="text-foreground-muted">
                {preview.prefix}
              </Text>
            ) : null}
            <Text textRole="footnote" className="text-foreground">
              {preview.remainder}
            </Text>
            {props.pending ? (
              <Text textRole="footnote" className="text-foreground-muted">
                {" …"}
              </Text>
            ) : null}
          </Text>
        )}
      </Pressable>

      <View className="shrink-0 flex-row items-center gap-0.5">
        {showWordAction ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Accept next word"
            hitSlop={6}
            onPress={() => {
              void Haptics.selectionAsync();
              props.onAcceptNextWord();
            }}
            className="h-8 min-w-8 items-center justify-center rounded-full bg-subtle px-2 active:opacity-65"
          >
            <SymbolView
              name="arrow.right"
              size={13}
              tintColorClassName="accent-icon"
              type="monochrome"
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next suggestion"
          accessibilityHint="Long press for fresh suggestions"
          disabled={props.pending}
          hitSlop={6}
          onPress={() => {
            void Haptics.selectionAsync();
            props.onCycle();
          }}
          onLongPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            props.onRefresh();
          }}
          className="h-8 min-w-8 flex-row items-center justify-center gap-1 rounded-full px-1.5 active:bg-subtle active:opacity-70"
          style={{ opacity: props.pending ? 0.45 : 1 }}
        >
          <SymbolView
            name="arrow.clockwise"
            size={13}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
          {altLabel !== null ? (
            <Text
              className="text-2xs text-foreground-muted"
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {altLabel}
            </Text>
          ) : null}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss suggestion"
          hitSlop={6}
          onPress={() => {
            void Haptics.selectionAsync();
            props.onDismiss();
          }}
          className="h-8 w-8 items-center justify-center rounded-full active:bg-subtle active:opacity-70"
        >
          <SymbolView
            name="xmark"
            size={13}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </Pressable>
      </View>
    </View>
  );

  return (
    <Animated.View entering={BAR_ENTERING} exiting={BAR_EXITING} className="mb-1.5">
      {Platform.OS === "ios" ? (
        <GlassSurface style={{ borderRadius: 18 }}>{content}</GlassSurface>
      ) : (
        <View className="rounded-2xl border border-border bg-card">{content}</View>
      )}
    </Animated.View>
  );
}
export interface ComposerSuggestionTriggerButtonProps {
  readonly size?: "regular" | "large";
  readonly onPress: () => void;
}

/** Compact toolbar trigger to fetch fresh prompt suggestions when no suggestion bar is open. */
export function ComposerSuggestionTriggerButton(props: ComposerSuggestionTriggerButtonProps) {
  const { scale } = useAndroidControlSizing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Suggest prompt"
      onPress={() => {
        void Haptics.selectionAsync();
        props.onPress();
      }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70"
    >
      <SymbolView
        name="text.bubble"
        size={Math.round((props.size === "large" ? 22 : 18) * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );
}
/* oxlint-enable t3code/no-untranslated-copy */
