import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  TextInput,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle
} from "react-native";

/**
 * Keeping text fields above the on-screen keyboard.
 *
 * Android apps now draw edge-to-edge, so the window no longer shrinks when the keyboard opens.
 * Instead, KeyboardSafe (around the app and inside each modal) adds padding equal to the part
 * of the screen the keyboard covers, and KeyboardAwareScrollView scrolls the focused field
 * into the space that is left.
 */

/** Space kept between the focused field and the top of the keyboard. */
const FIELD_MARGIN = 24;

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/** Shrinks its content to the area above the keyboard. Use at the root of the app and of each Modal. */
export function KeyboardSafe(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView behavior="padding" style={[{ flex: 1 }, props.style]}>
      {props.children}
    </KeyboardAvoidingView>
  );
}

/** A ScrollView that brings the focused text field into view when the keyboard opens. */
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardAwareScrollView(props, ref) {
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const height = useRef(0);
  useImperativeHandle(ref, () => scroll.current as ScrollView);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      const view = scroll.current;
      const focused = TextInput.State.currentlyFocusedInput();
      // getInnerViewRef exists at runtime but is missing from the TypeScript types.
      const inner = (view as (ScrollView & { getInnerViewRef?: () => Parameters<NonNullable<typeof focused>["measureLayout"]>[0] | null }) | null)?.getInnerViewRef?.();
      if (!view || !focused || !inner) return;
      // Fails quietly when the focused field is not inside this scroll view.
      focused.measureLayout(
        inner,
        (_x, y, _width, fieldHeight) => {
          const visible = height.current;
          if (!visible) return;
          if (y + fieldHeight + FIELD_MARGIN > offset.current + visible) {
            view.scrollTo({ y: Math.max(0, y + fieldHeight + FIELD_MARGIN - visible), animated: true });
          } else if (y - FIELD_MARGIN < offset.current) {
            view.scrollTo({ y: Math.max(0, y - FIELD_MARGIN), animated: true });
          }
        },
        () => undefined
      );
    };
    // Wait for the layout to shrink above the keyboard before measuring.
    const show = Keyboard.addListener("keyboardDidShow", () => {
      clearTimeout(timer);
      timer = setTimeout(reveal, 120);
    });
    return () => {
      clearTimeout(timer);
      show.remove();
    };
  }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
    props.onScroll?.(event);
  };
  const onLayout = (event: LayoutChangeEvent) => {
    height.current = event.nativeEvent.layout.height;
    props.onLayout?.(event);
  };

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="none"
      scrollEventThrottle={16}
      {...props}
      ref={scroll}
      onScroll={onScroll}
      onLayout={onLayout}
    />
  );
});
