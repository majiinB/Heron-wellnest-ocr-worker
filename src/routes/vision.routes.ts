import express, { Router } from "express";
import { VisionController } from "../controllers/vision.controller.js";
import visionService from "../services/vision.service.js";
import { asyncHandler } from "../utils/asyncHandler.util.js";

const router: Router = express.Router();
const visionController = new VisionController(visionService);

/**
 * @openapi
 * /vision/extract-text:
 *   post:
 *     summary: Extract text from an image using Google Cloud Vision OCR
 *     description: Accepts either a full `gcsUri` or `bucketName` + `fileName` and returns extracted OCR text.
 *     tags:
 *       - Vision
 *     security:
 *       - bearerAuth: []
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
 *             description: Provide `gcsUri`, or provide `bucketName` and `fileName`.
 *     responses:
 *       "200":
 *         description: Text extracted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 code:
 *                   type: string
 *                   example: VISION_TEXT_EXTRACTED
 *                 message:
 *                   type: string
 *                   example: Text extracted successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     gcsUri:
 *                       type: string
 *                       example: gs://my-bucket/path/to/image.png
 *                     fullText:
 *                       type: string
 *                       example: Sample extracted text
 *                     textDetections:
 *                       type: array
 *                       items:
 *                         type: string
 *       "400":
 *         description: Bad request - invalid payload
 *       "401":
 *         description: Unauthorized - missing or invalid token
 *       "500":
 *         description: Internal server error
 */
router.post("/extract-text", asyncHandler(visionController.handleExtractText.bind(visionController)));

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
router.post("/extract-and-match", asyncHandler(visionController.handleExtractAndMatch.bind(visionController)));

export default router;
