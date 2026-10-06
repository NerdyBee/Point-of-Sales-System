import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

const maxSide = 512;

/**
 * Lets the owner pick a logo from the gallery and returns it as a base64 PNG no larger than
 * 512 px, or null if they cancelled. PNG keeps transparent backgrounds (printed as white).
 */
export async function pickLogo(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsEditing: false });
  if (result.canceled || !result.assets.length) return null;
  const asset = result.assets[0];

  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > maxSide) {
    context.resize(asset.width >= asset.height ? { width: maxSide } : { height: maxSide });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  if (!saved.base64) throw new Error("Could not read that image. Try another picture.");
  return saved.base64;
}
