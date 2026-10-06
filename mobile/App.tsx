import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AppProvider } from "./src/shell/AppContext";
import { Shell } from "./src/shell/Shell";
import type { Platform } from "./src/data/db";
import { createExpoPlatform } from "./src/data/expoPlatform";
import { migrate } from "./src/data/schema";
import { colors, font, spacing } from "./src/ui/theme";
import appConfig from "./app.json";

export default function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        {platform ? (
          <AppProvider platform={platform}>
            <Shell />
          </AppProvider>
        ) : (
          <View style={styles.center}>
            {error ? <Text style={styles.error}>Could not open the local database: {error}</Text> : <ActivityIndicator size="large" color={colors.primary} />}
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  error: { color: colors.danger, fontSize: font.md }
});
