import { useWindowDimensions } from "react-native";

/** Below this width (phones, small tablets in portrait) screens stack instead of splitting. */
export const compactBreakpoint = 700;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const compact = width < compactBreakpoint;
  return { width, height, compact, productColumns: width < 420 ? 2 : width < compactBreakpoint ? 3 : width < 1100 ? 3 : 4 };
}
