import express, { Router } from "express";
import { VisionController } from "../controllers/vision.controller.js";
import visionService from "../services/vision.service.js";
import { asyncHandler } from "../utils/asyncHandler.util.js";
import { googleAuthMiddleware } from "../middlewares/googleAuth.middleware.js";

const router: Router = express.Router();
const visionController = new VisionController(visionService);

/**
 * @openapi
 * /vision/extract-and-match:
 *   post:
 *     summary: Extract text and match configured COR fields
 *     description: Extracts OCR text then matches department, name/email, year level, school year, and dean name.
 *     tags:
 *       - Vision
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               gcsUri:
 *                 type: string
 *                 example: gs://my-bucket/path/to/image.png
 *               bucketName:
 *                 type: string
 *                 example: my-bucket
 *               fileName:
 *                 type: string
 *                 example: path/to/image.png
 *               departmentCandidates:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["COLLEGE OF COMPUTING AND INFORMATION SCIENCES", "COLLEGE OF BUSINESS"]
 *               expectedName:
 *                 type: string
 *                 example: Arthur Marmita Artugue
 *               expectedEmail:
 *                 type: string
 *                 example: aartugue.a12241566@umak.edu.ph
 *             description: Provide either `gcsUri` or `bucketName` + `fileName`.
 *     responses:
 *       "200":
 *         description: Text extracted and matched successfully
 *       "400":
 *         description: Bad request - invalid payload
 *       "500":
 *         description: Internal server error
 */
router.post("/extract-and-match", googleAuthMiddleware, asyncHandler(visionController.handleExtractAndMatch.bind(visionController)));

export default router;
