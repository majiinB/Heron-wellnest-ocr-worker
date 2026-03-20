import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interface/authRequest.interface.js";
import type { VisionService } from "../services/vision.service.js";
import type { ApiResponse } from "../types/apiResponse.type.js";
import { AppError } from "../types/appError.type.js";
import { logger } from "../utils/logger.util.js";
import { validate as isUuid } from "uuid";

type PubSubMessageEnvelope = {
	message?: {
		data?: string;
		messageId?: string;
		attributes?: Record<string, string>;
		publishTime?: string;
	};
	subscription?: string;
};

type VisionPubSubPayload = {
	gcsUri: string;
	userId: string;
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
		try {
			const payload = this.parsePubSubPayload(req.body);
			const gcsUri = payload.gcsUri.toString().trim();

			if (!gcsUri) {
				throw new AppError(400, "BAD_REQUEST", "Bad Request: gcsUri is required", true);
			}

			const extractionResult = await this.visionService.extractTextFromGcsUri(gcsUri);

			const response: ApiResponse = {
				success: true,
				code: "VISION_TEXT_EXTRACTED",
				message: "Text extracted successfully",
				data: extractionResult,
			};

			res.status(200).json(response);
		} catch (error) {
			if (this.isNonRetryableError(error)) {
				this.acknowledgeNonRetryableError(res, "VISION_TEXT_EXTRACT_SKIPPED", error);
				return;
			}

			throw error;
		}
	}

	/**
	 * Handles OCR extraction and matching of target fields from COR text.
	 */
	public async handleExtractAndMatch(req: AuthenticatedRequest, res: Response, _next: NextFunction): Promise<void> {
		try {
			const payload = this.parsePubSubPayload(req.body);
			const gcsUri = payload.gcsUri?.toString().trim();
			const studentId = payload.userId?.toString().trim();

			if (!gcsUri) {
				throw new AppError(400, "BAD_REQUEST", "Bad Request: gcsUri is required", true);
			}

			if (!studentId) {
				throw new AppError(400, "BAD_REQUEST", "Bad Request: userId is required", true);
			}

			if (!isUuid(studentId)) {
				throw new AppError(400, "BAD_REQUEST", "Bad Request: Invalid userId format", true);
			}

			const extractionResult = await this.visionService.extractCorDataFromGcsUri(gcsUri, studentId);

			const response: ApiResponse = {
				success: true,
				code: "VISION_TEXT_MATCHED",
				message: "Text extracted and matched successfully",
				data: extractionResult,
			};

			res.status(200).json(response);
		} catch (error) {
			if (this.isNonRetryableError(error)) {
				this.acknowledgeNonRetryableError(res, "VISION_TEXT_MATCH_SKIPPED", error);
				return;
			}

			throw error;
		}
	}

	private isNonRetryableError(error: unknown): boolean {
		if (!(error instanceof AppError)) {
			return false;
		}

		return error.statusCode >= 400 && error.statusCode < 500;
	}

	private acknowledgeNonRetryableError(res: Response, code: string, error: unknown): void {
		const message = error instanceof Error ? error.message : "Non-retryable error encountered";
		logger.warn("[VisionController] Non-retryable error acknowledged for Pub/Sub push", { code, message });

		const response: ApiResponse = {
			success: true,
			code,
			message: `Message acknowledged without retry: ${message}`,
		};

		res.status(200).json(response);
	}

	private parsePubSubPayload(body: unknown): VisionPubSubPayload {
		const envelope = body as PubSubMessageEnvelope;

		if (!envelope || typeof envelope !== "object" || !envelope.message) {
			logger.error("[VisionController] Invalid Pub/Sub message format", { body });
			throw new AppError(400, "BAD_REQUEST", "Bad Request: Invalid Pub/Sub message format", true);
		}

		if (!envelope.message.data) {
			logger.error("[VisionController] No data field in Pub/Sub message", { message: envelope.message });
			throw new AppError(400, "BAD_REQUEST", "Bad Request: No data field in Pub/Sub message", true);
		}

		let decoded: string;
		try {
			decoded = Buffer.from(envelope.message.data, "base64").toString("utf-8");
		} catch (error) {
			logger.error("[VisionController] Failed to decode Pub/Sub data", { error });
			throw new AppError(400, "BAD_REQUEST", "Bad Request: Unable to decode Pub/Sub message data", true);
		}

		let payload: VisionPubSubPayload;
		try {
			payload = JSON.parse(decoded) as VisionPubSubPayload;
		} catch (error) {
			logger.error("[VisionController] Invalid JSON in Pub/Sub data", { decoded, error });
			throw new AppError(400, "BAD_REQUEST", "Bad Request: Invalid JSON in Pub/Sub message data", true);
		}

		return payload;
	}
}
