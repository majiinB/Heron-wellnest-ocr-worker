import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interface/authRequest.interface.js";
import type { VisionService } from "../services/vision.service.js";
import type { ApiResponse } from "../types/apiResponse.type.js";
import { AppError } from "../types/appError.type.js";
import { logger } from "../utils/logger.util.js";

type VisionOcrBody = {
	gcsUri: string;
	userId: string
// 	bucketName?: string;
// 	fileName?: string;
// 	departmentCandidates?: string[];
// 	expectedName?: string;
// 	expectedEmail?: string;
};

/**
 * Controller class for Vision OCR endpoints.
 *
 * @description
 * Validates OCR input payloads and delegates text extraction to VisionService.
 */
export class VisionController {
	private visionService: VisionService;

	constructor(visionService: VisionService) {
		this.visionService = visionService;
	}

	/**
	 * Handles OCR text extraction from a GCS image.
	 *
	 * Accepts either:
	 * - `gcsUri` (preferred), or
	 * - `bucketName` + `fileName`.
	 *
	 * @param req - The request containing OCR input in the body.
	 * @param res - The response object.
	 * @param _next - The next middleware function (unused).
	 * @throws {AppError} If payload is missing or invalid.
	 */
	public async handleExtractText(req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> {
		const body = req.body as VisionOcrBody;

		if (!body || typeof body !== "object") {
			logger.error("[VisionController] Missing OCR request body", { body: req.body });
			res.status(200).json({
				success: false,
				code: "VISION_OCR_FAILED",
				message: "Text extraction failed: request body is required",
			} as ApiResponse);
			return;
		}

		const gcsUri = body.gcsUri?.toString().trim();


		const extractionResult = await this.visionService.extractTextFromGcsUri(gcsUri)
			

		const response: ApiResponse = {
			success: true,
			code: "VISION_TEXT_EXTRACTED",
			message: "Text extracted successfully",
			data: extractionResult,
		};

		res.status(200).json(response);
	}

	/**
	 * Handles OCR extraction and matching of target fields from COR text.
	 */
	public async handleExtractAndMatch(req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> {
		const body = req.body as VisionOcrBody;

		if (!body || typeof body !== "object") {
			logger.error("[VisionController] Missing OCR request body", { body: req.body });
			res.status(200).json({
				success: false,
				code: "VISION_OCR_FAILED",
				message: "Text extraction failed: request body is required",
			} as ApiResponse);
			return;
		}

		const gcsUri = body.gcsUri?.toString().trim();
		const studentId = body.userId?.toString().trim();
		

		const extractionResult = await this.visionService.extractCorDataFromGcsUri(gcsUri, studentId);

		const response: ApiResponse = {
			success: true,
			code: "VISION_TEXT_MATCHED",
			message: "Text extracted and matched successfully",
			data: extractionResult,
		};

		res.status(200).json(response);
	}
}
