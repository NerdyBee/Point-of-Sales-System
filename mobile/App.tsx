import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import appConfig from "./app.json";
import type { Platform } from "./src/data/db";
import { createExpoPlatform } from "./src/data/expoPlatform";
import { migrate } from "./src/data/schema";
import { AppProvider } from "./src/shell/AppContext";
import { Shell } from "./src/shell/Shell";
import { AppSplash, SPLASH_MIN_MS } from "./src/ui/AppSplash";
import { AboutLine, BrandHeader } from "./src/ui/BrandMark";
import { ErrorBoundary } from "./src/ui/ErrorBoundary";
import { KeyboardSafe } from "./src/ui/keyboard";
import { Button } from "./src/ui/components";
import { colors, font, spacing } from "./src/ui/theme";

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    void (async () => {
      setOpening(true);
      try {
        const created = await createExpoPlatform(`tablet/${appConfig.expo.version}`);
        await migrate(created.db);
        setError(null);
        setPlatform(created);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setOpening(false);
      }
    })();
  }, [attempt]);

  // Status bar icons: light on the navy splash, dark on the app.
  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style={splashVisible ? "light" : "dark"} />
        <KeyboardSafe>
        <SafeAreaView style={styles.root}>
          {platform ? (
            <AppProvider platform={platform}>
              <ErrorBoundary>
                <Shell />
              </ErrorBoundary>
            </AppProvider>
          ) : (
            <View style={styles.center}>
              <BrandHeader size={120} />
              {error ? (
                <>
                  <Text style={styles.error}>The shop's records could not be opened. Your data is still on this phone. Tap Try again; if it keeps happening, close the app fully and reopen it.</Text>
                  <Button label="Try again" busy={opening} onPress={() => setAttempt((value) => value + 1)} />
                  <Text style={styles.detail}>Details: {error}</Text>
                </>
              ) : (
                <ActivityIndicator size="large" color={colors.primary} />
              )}
              <AboutLine />
            </View>
          )}
        </SafeAreaView>
        </KeyboardSafe>
        {/* Branded splash over everything while the app starts (min. 2.5 s), then fades out. */}
        <AppSplash ready={Boolean(platform || error)} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  error: { color: colors.danger, fontSize: font.md, textAlign: "center" },
  detail: { color: colors.textMuted, fontSize: font.sm, textAlign: "center" }
});
