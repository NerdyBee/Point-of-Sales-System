import { Component, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "./components";
import { colors, font, spacing } from "./theme";

/**
 * Catches an error while a screen is drawn, so one bad record or bug shows a message with a
 * way back instead of closing the app. Saved data is not affected.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Screen error", error);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.box}>
          <Text style={styles.title}>Something went wrong on this screen</Text>
          <Text style={styles.text}>Your saved sales and records are safe. Tap the button below to go back. If it keeps happening, send a screenshot of this message to Ajoke Code Sphere.</Text>
          <Button label="Go back" onPress={this.reset} large />
          <Text style={styles.detail}>{this.state.error.message}</Text>
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  box: { gap: spacing.lg, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontSize: font.xl, fontWeight: "700", color: colors.text },
  text: { fontSize: font.md, color: colors.text },
  detail: { fontSize: font.sm, color: colors.textMuted }
});
