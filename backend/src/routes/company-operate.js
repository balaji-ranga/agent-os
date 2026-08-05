/**
 * Company Operate API (Phase D Day 0 + Day 1).
 */
import { Router } from "express";
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from "../middleware/auth.js";
import {
  getOperateGate,
  skipOperate,
  beginOperate,
  getOperateState,
  saveOperateDraft,
  designOperate,
  confirmOperateDay0,
  applyOperateDay1,
} from "../services/company-operate.js";

const router = Router();
router.use(requireAuth);
router.use(requireCeoOrAdmin);

function ownerOr403(req, res) {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
    if (!owner) {
      res.status(403).json({ error: "CEO context required" });
      return null;
    }
    return owner;
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message || "CEO context required" });
    return null;
  }
}

router.get("/gate", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(getOperateGate(owner));
  } catch (e) {
    console.warn("[company-operate] gate failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to load operate gate" });
  }
});

router.post("/skip", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(skipOperate(owner));
  } catch (e) {
    console.warn("[company-operate] skip failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to skip operate setup" });
  }
});

router.post("/begin", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(beginOperate(owner));
  } catch (e) {
    console.warn("[company-operate] begin failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to begin operate setup" });
  }
});

router.get("/state", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(getOperateState(owner));
  } catch (e) {
    console.warn("[company-operate] state failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to load operate state" });
  }
});

router.put("/draft", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(saveOperateDraft(owner, req.body || {}));
  } catch (e) {
    console.warn("[company-operate] draft failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to save operate draft" });
  }
});

router.post("/design", async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(await designOperate(owner, req.body || {}));
  } catch (e) {
    console.warn("[company-operate] design failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to design operating model" });
  }
});

router.post("/confirm", (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(confirmOperateDay0(owner, req.body || {}));
  } catch (e) {
    console.warn("[company-operate] confirm failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to confirm operating model" });
  }
});

router.post("/apply-day1", async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(await applyOperateDay1(owner));
  } catch (e) {
    console.warn("[company-operate] apply-day1 failed", e?.message || e);
    res.status(e.status || 500).json({ error: e.message || "Failed to apply Day 1 operate install" });
  }
});

export default router;
