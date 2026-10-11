import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text } from "react-native";
import appConfig from "../../app.json";
import { BRAND } from "../brand";

const logo = require("../../assets/logo.png") as number;

/** Same navy as the native splash screen (app.json), so the hand-over is seamless. */
export const SPLASH_BACKGROUND = appConfig.expo.backgroundColor;
/** How long the branded splash stays up at minimum, from app start. */
export const SPLASH_MIN_MS = 2500;
const FADE_MS = 450;

// Keep Android/iOS's native splash up until our own splash has drawn (called at module load,
// as Expo recommends, so it runs before the native splash would auto-hide).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 250 });

const startedAt = Date.now();

/**
 * Full-screen branded splash drawn over the app while it starts. It replaces the native splash
 * (which Android shows only briefly and crops), stays for at least SPLASH_MIN_MS and until
 * `ready`, then fades out. The app keeps loading underneath the whole time.
 */
export function AppSplash(props: { ready: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!props.ready) return;
    const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setGone(true));
    }, wait);
    return () => clearTimeout(timer);
  }, [props.ready, opacity]);

  if (gone) return null;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.splash, { opacity }]}
      pointerEvents={props.ready ? "none" : "auto"}
      // Our splash is on screen: now the native one can go without a flash.
      onLayout={() => SplashScreen.hide()}
      accessibilityLabel={`${BRAND.appName}, loading`}
    >
      <Image source={logo} style={styles.logo} resizeMode="contain" />
      <Text style={styles.name}>{BRAND.appName}</Text>
      <Text style={styles.by}>Developed by {BRAND.developer}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  splash: { backgroundColor: SPLASH_BACKGROUND, alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000 },
  logo: { width: 200, height: 200 },
  name: { marginTop: 20, fontSize: 28, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.5 },
  by: { marginTop: 6, fontSize: 13, color: "#8FA3B8" }
});
