import { Router, type Request } from "express";
import { z } from "zod";
import { BusinessSetupError, businessCount, createBusiness } from "./setup.service";

/**
 * First-run setup for an offline office install: while the database has no business, the
 * web app shows a "Create your business" page instead of the sign-in screen.
 *
 * Creating is only allowed from the server computer itself (http://localhost), so nobody else
 * on the shop network, or the internet, can claim a fresh install. The cloud sits behind a
 * proxy, so its requests are never local; cloud businesses are created with `business create`.
 */
export const setupRouter = Router();

const isDemoMode = process.env.NODE_ENV === "test";

const setupSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  vatPercent: z.number().min(0).max(99),
  branchName: z.string().trim().max(80).optional(),
  city: z.string().trim().max(100).optional(),
  ownerName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(32).optional(),
  password: z.string().min(8).max(120),
  pin: z.string().regex(/^\d{6}$/).optional().or(z.literal(""))
});

function isLocalRequest(req: Request) {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

setupRouter.get("/status", async (req, res) => {
  if (isDemoMode) {
    res.json({ needsSetup: false, local: isLocalRequest(req) });
    return;
  }
  res.json({ needsSetup: (await businessCount()) === 0, local: isLocalRequest(req) });
});

setupRouter.post("/", async (req, res) => {
  if (isDemoMode || (await businessCount()) > 0) {
    res.status(409).json({ error: "This installation already has a business. Sign in instead." });
    return;
  }
  if (!isLocalRequest(req)) {
    res.status(403).json({ error: "Set up Ajoke POS on the computer where it is installed, at http://localhost:4000." });
    return;
  }

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please check the form", issues: parsed.error.flatten() });
    return;
  }

  try {
    const input = parsed.data;
    const business = await createBusiness({
      name: input.businessName,
      currency: input.currency,
      taxRate: input.vatPercent / 100,
      branchName: input.branchName,
      city: input.city,
      ownerName: input.ownerName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      pin: input.pin || undefined
    });
    res.status(201).json({ business });
  } catch (error) {
    if (error instanceof BusinessSetupError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});
