import { Router } from "express";
import { governorValidator } from "@the-governor-hq/constitution-core";
import { z } from "zod";

const previewSchema = z.object({
  message: z.string().min(1),
});

export const briefingsRouter = Router();

briefingsRouter.post(
  "/preview",
  governorValidator({ domain: "wearables", onViolation: "block" }),
  (req, res) => {
    const parsedBody = previewSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "Invalid body", details: parsedBody.error.flatten() });
    }

    return res.status(200).json({
      message: parsedBody.data.message,
      validated: req.validated?.safe ?? true,
    });
  },
);
