import { Router } from "express";
import { z } from "zod";
import { activateLicense, licenseState, publicLicenseState } from "./license";

export const licenseRouter = Router();

licenseRouter.get("/", async (_req, res) => {
  res.json(publicLicenseState(await licenseState()));
});

/** Anyone may submit a code: it only works if it was signed for this computer. */
licenseRouter.post("/", async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(20).max(4000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Paste the whole activation code." });
    return;
  }
  const state = await activateLicense(parsed.data.code);
  if (!state.active) {
    res.status(400).json({ error: state.message });
    return;
  }
  res.json(publicLicenseState(state));
});
