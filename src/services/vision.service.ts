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

export type VisionCorMatchInput = {
	departmentCandidates?: string[];
	expectedName?: string;
	expectedEmail?: string;
};

export type VisionCorMatchResult = {
	department?: string;
	nameMatched: boolean;
	emailMatched: boolean;
	yearLevel?: string;
	schoolYear?: string;
	deanName?: string;
};

export type VisionCorExtractionResult = VisionTextExtractionResult & {
	matched: VisionCorMatchResult;
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
	 * Extracts OCR text and matches configurable COR fields from a full GCS URI.
	 */
	public async extractCorDataFromGcsUri(
		gcsUri: string,
		input: VisionCorMatchInput,
	): Promise<VisionCorExtractionResult> {
		const extraction = await this.extractTextFromGcsUri(gcsUri);

		return {
			...extraction,
			matched: this.matchCorFields(extraction.fullText, input),
		};
	}

	/**
	 * Extracts OCR text and matches configurable COR fields from bucket + file path.
	 */
	public async extractCorDataFromGcsFile(
		bucketName: string,
		fileName: string,
		input: VisionCorMatchInput,
	): Promise<VisionCorExtractionResult> {
		const gcsUri = this.buildGcsUri(bucketName, fileName);
		return await this.extractCorDataFromGcsUri(gcsUri, input);
	}

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

	/**
	 * Matches structured fields from the OCR text using configured candidates.
	 */
	private matchCorFields(fullText: string, input: VisionCorMatchInput): VisionCorMatchResult {
		const normalizedText = this.normalizeText(fullText);
		const department = this.matchDepartment(normalizedText, input.departmentCandidates ?? []);

		return {
			department,
			nameMatched: this.matchExpectedName(normalizedText, input.expectedName),
			emailMatched: this.matchExpectedEmail(fullText, input.expectedEmail),
			yearLevel: this.extractYearLevel(fullText),
			schoolYear: this.extractSchoolYear(fullText),
			deanName: this.extractDeanName(fullText),
		};
	}

	private normalizeText(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private matchDepartment(normalizedText: string, candidates: string[]): string | undefined {
		for (const candidate of candidates) {
			const normalizedCandidate = this.normalizeText(candidate);
			if (normalizedCandidate && normalizedText.includes(normalizedCandidate)) {
				return candidate;
			}
		}

		return undefined;
	}

	private matchExpectedEmail(fullText: string, expectedEmail?: string): boolean {
		if (!expectedEmail?.trim()) {
			return false;
		}

		return fullText.toLowerCase().includes(expectedEmail.trim().toLowerCase());
	}

	private matchExpectedName(normalizedText: string, expectedName?: string): boolean {
		if (!expectedName?.trim()) {
			return false;
		}

		const tokens = this
			.normalizeText(expectedName)
			.split(" ")
			.filter((token) => token.length >= 2);

		if (tokens.length === 0) {
			return false;
		}

		const matchedCount = tokens.filter((token) => normalizedText.includes(token)).length;
		const requiredMatches = Math.max(2, Math.ceil(tokens.length * 0.6));

		return matchedCount >= requiredMatches;
	}

	private extractYearLevel(text: string): string | undefined {
		const yearLevels: Array<{ regex: RegExp; value: string }> = [
			{ regex: /\bfirst\s+year\b/i, value: "First Year" },
			{ regex: /\bsecond\s+year\b/i, value: "Second Year" },
			{ regex: /\bthird\s+year\b/i, value: "Third Year" },
			{ regex: /\bfourth\s+year\b/i, value: "Fourth Year" },
			{ regex: /\bfifth\s+year\b/i, value: "Fifth Year" },
			{ regex: /\b1st\s+year\b/i, value: "First Year" },
			{ regex: /\b2nd\s+year\b/i, value: "Second Year" },
			{ regex: /\b3rd\s+year\b/i, value: "Third Year" },
			{ regex: /\b4th\s+year\b/i, value: "Fourth Year" },
			{ regex: /\b5th\s+year\b/i, value: "Fifth Year" },
		];

		for (const candidate of yearLevels) {
			if (candidate.regex.test(text)) {
				return candidate.value;
			}
		}

		return undefined;
	}

	private extractSchoolYear(text: string): string | undefined {
		const match = text.match(/(\d{4})\s*[-–]\s*(\d{4})/);

		if (!match) {
			return undefined;
		}

		const start = parseInt(match[1], 10);
		const end = parseInt(match[2], 10);

		if (start >= 2000 && start <= 2100 && end === start + 1) {
			return `${start}-${end}`;
		}

		return undefined;
	}

	private extractDeanName(text: string): string | undefined {
		const lines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		const deanLineIndex = lines.findIndex((line) => /dean\s*\/\s*director/i.test(line));
		if (deanLineIndex <= 0) {
			return undefined;
		}

		const candidate = lines[deanLineIndex - 1]
			.replace(/\s{2,}/g, " ")
			.replace(/\.{2,}/g, ".")
			.trim();

		if (!candidate || /student'?s\s+signature/i.test(candidate)) {
			return undefined;
		}

		return candidate;
	}
}

const visionService = new VisionService();

export default visionService;
