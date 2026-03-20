import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interface/authRequest.interface.js";
import type { VisionService } from "../services/vision.service.js";
import type { ApiResponse } from "../types/apiResponse.type.js";
import { AppError } from "../types/appError.type.js";
import { logger } from "../utils/logger.util.js";

type VisionOcrBody = {
	gcsUri?: string;
	bucketName?: string;
	fileName?: string;
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
			throw new AppError(400, "BAD_REQUEST", "Bad Request: request body is required", true);
		}

		const gcsUri = body.gcsUri?.toString().trim();
		const bucketName = body.bucketName?.toString().trim();
		const fileName = body.fileName?.toString().trim();

		if (!gcsUri && !(bucketName && fileName)) {
			throw new AppError(
				400,
				"BAD_REQUEST",
				"Bad Request: provide either gcsUri or bucketName and fileName",
				true,
			);
		}

		const extractionResult = gcsUri
			? await this.visionService.extractTextFromGcsUri(gcsUri)
			: await this.visionService.extractTextFromGcsFile(bucketName!, fileName!);

		const response: ApiResponse = {
			success: true,
			code: "VISION_TEXT_EXTRACTED",
			message: "Text extracted successfully",
			data: extractionResult,
		};

		res.status(200).json(response);
	}
}
