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
import { colors, font, spacing } from "./src/ui/theme";

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splashVisible, setSplashVisible] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const created = await createExpoPlatform(`tablet/${appConfig.expo.version}`);
        await migrate(created.db);
        setPlatform(created);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  // Status bar icons: light on the navy splash, dark on the app.
  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), SPLASH_MIN_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style={splashVisible ? "light" : "dark"} />
        <SafeAreaView style={styles.root}>
          {platform ? (
            <AppProvider platform={platform}>
              <Shell />
            </AppProvider>
          ) : (
            <View style={styles.center}>
              <BrandHeader size={120} />
              {error ? <Text style={styles.error}>Could not open the local database: {error}</Text> : <ActivityIndicator size="large" color={colors.primary} />}
              <AboutLine />
            </View>
          )}
        </SafeAreaView>
        {/* Branded splash over everything while the app starts (min. 2.5 s), then fades out. */}
        <AppSplash ready={Boolean(platform || error)} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.lg },
  error: { color: colors.danger, fontSize: font.md }
});
