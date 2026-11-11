import { z } from "zod";

/** Creation part of the autopilot (Spec 3 D): ideas that become drafts for review. Never publishes. */
export const creationPilotSchema = z.object({
  queue: z.array(z.object({ title: z.string().max(100), brief: z.string().min(1).max(750) })).max(40),
  enabled: z.boolean(),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  everyDays: z.number().int().min(1).max(14),
  nextAt: z.number().finite().optional(),
  running: z.boolean().optional(),
  error: z.string().max(2000).optional(),
});
export type CreationPilot = z.infer<typeof creationPilotSchema>;
export const blankCreationPilot: CreationPilot = { queue: [], enabled: false, time: "18:00", everyDays: 1 };
