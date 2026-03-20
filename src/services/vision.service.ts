import { protos } from "@google-cloud/vision";
import visionClient from "../config/vision.config.js";
import { AppError } from "../types/appError.type.js";
import { logger } from "../utils/logger.util.js";

type EntityAnnotation = protos.google.cloud.vision.v1.IEntityAnnotation;

export type VisionTextExtractionResult = {
	gcsUri: string;
	fullText: string;
	textDetections: string[];
};

/**
 * Service class for Google Cloud Vision OCR operations.
 *
 * @description
 * Provides methods to extract text from images stored in Google Cloud Storage
 * using a shared Vision client instance from configuration.
 */
export class VisionService {
	/**
	 * Performs OCR text detection using a full Google Cloud Storage URI.
	 *
	 * @param gcsUri - Full GCS URI in the format `gs://bucket/path/to/file`.
	 * @returns A normalized OCR result containing full text and tokenized detections.
	 */
	public async extractTextFromGcsUri(gcsUri: string): Promise<VisionTextExtractionResult> {
		const normalizedGcsUri = this.validateAndNormalizeGcsUri(gcsUri);

		try {
			const [result] = await visionClient.textDetection(normalizedGcsUri);
			const annotations: EntityAnnotation[] = result.textAnnotations ?? [];

			return {
				gcsUri: normalizedGcsUri,
				fullText: annotations[0]?.description?.trim() ?? "",
				textDetections: annotations
					.map((annotation) => annotation.description?.trim() ?? "")
					.filter((text) => text.length > 0),
			};
		} catch (error) {
			logger.error(`Vision OCR failed for ${normalizedGcsUri}.`, error);

			throw new AppError(
				502,
				"VISION_TEXT_DETECTION_FAILED",
				"Failed to extract text from image using Cloud Vision API",
				true,
			);
		}
	}

	/**
	 * Performs OCR text detection on an image in Google Cloud Storage.
	 *
	 * @param bucketName - Name of the GCS bucket where the image resides.
	 * @param fileName - Path to the image file within the bucket.
	 * @returns A normalized OCR result containing full text and tokenized detections.
	 */
	public async extractTextFromGcsFile(
		bucketName: string,
		fileName: string,
	): Promise<VisionTextExtractionResult> {
		const gcsUri = this.buildGcsUri(bucketName, fileName);
		return await this.extractTextFromGcsUri(gcsUri);
	}

	/**
	 * Convenience method to return only the full OCR text block for a GCS URI.
	 *
	 * @param gcsUri - Full GCS URI in the format `gs://bucket/path/to/file`.
	 * @returns The full detected text string (empty when no text is detected).
	 */
	public async extractFullTextFromGcsUri(gcsUri: string): Promise<string> {
		const result = await this.extractTextFromGcsUri(gcsUri);
		return result.fullText;
	}

	/**
	 * Convenience method to return only the full OCR text block for a GCS image.
	 *
	 * @param bucketName - Name of the GCS bucket where the image resides.
	 * @param fileName - Path to the image file within the bucket.
	 * @returns The full detected text string (empty when no text is detected).
	 */
	public async extractFullTextFromGcsFile(bucketName: string, fileName: string): Promise<string> {
		const result = await this.extractTextFromGcsFile(bucketName, fileName);
		return result.fullText;
	}

	/**
	 * Builds and validates a Google Cloud Storage URI for Vision requests.
	 */
	private buildGcsUri(bucketName: string, fileName: string): string {
		const normalizedBucket = bucketName.trim();
		const normalizedFile = fileName.trim().replace(/^\/+/, "");

		if (!normalizedBucket || !normalizedFile) {
			throw new AppError(
				400,
				"INVALID_GCS_IMAGE_REFERENCE",
				"Both bucketName and fileName are required to process OCR",
				true,
			);
		}

		return `gs://${normalizedBucket}/${normalizedFile}`;
	}

	/**
	 * Validates and normalizes a full Google Cloud Storage URI.
	 */
	private validateAndNormalizeGcsUri(gcsUri: string): string {
		const normalized = gcsUri.trim();

		if (!/^gs:\/\/.+\/.+/i.test(normalized)) {
			throw new AppError(
				400,
				"INVALID_GCS_URI",
				"gcsUri must be in the format gs://bucket/path/to/file",
				true,
			);
		}

		return normalized;
	}
}

const visionService = new VisionService();

export default visionService;
