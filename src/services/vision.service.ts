import { protos } from "@google-cloud/vision";
import visionClient from "../config/vision.config.js";
import { CollegeDepartmentRepository, type CollegeDepartmentRow } from "../repository/collegeDepartment.repository.js";
import { AppError } from "../types/appError.type.js";
import { logger } from "../utils/logger.util.js";
import { StudentRepository } from "../repository/student.repository.js";
import { SystemConfigRepository } from "../repository/systemConfig.repository.js";
import { publishMessage } from "../utils/pubsub.util.js";
import { env } from "../config/env.config.js";

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
	program?: string;
	programId?: string;
	nameMatched: boolean;
	emailMatched: boolean;
	yearLevel?: string;
	schoolYear?: string;
};

/**
 * Service class for Google Cloud Vision OCR operations.
 *
 * @description
 * Provides methods to extract text from images stored in Google Cloud Storage
 * using a shared Vision client instance from configuration.
 */
export class VisionService {
	private collegeDepartmentRepository: CollegeDepartmentRepository;
	private studentRepository: StudentRepository;
	private systemConfigRepository : SystemConfigRepository;

	constructor(
		collegeDepartmentRepository: CollegeDepartmentRepository = new CollegeDepartmentRepository(), 
		studentRepository: StudentRepository = new StudentRepository(),
		systemConfigRepository: SystemConfigRepository = new SystemConfigRepository()
	) {
		this.collegeDepartmentRepository = collegeDepartmentRepository;
		this.studentRepository = studentRepository;
		this.systemConfigRepository = systemConfigRepository;
	}

	/**
	 * Extracts OCR text and matches configurable COR fields from a full GCS URI.
	 */
	public async extractCorDataFromGcsUri(gcsUri: string, studentId: string): Promise<VisionCorMatchResult> {
		const extraction = await this.extractTextFromGcsUri(gcsUri);
		
		const studentInfo = await this.studentRepository.findStudentInfoById(studentId);
		const systemConfig = await this.systemConfigRepository.RetrieveSystemConfig();

		const result : VisionCorMatchResult = {
			department: undefined,
			program: undefined,
			programId: undefined,
			nameMatched: false,
			emailMatched: false,
			yearLevel: undefined,
			schoolYear: undefined,
		}

		if (!studentInfo) {
			logger.warn(`Student info not found for ID ${studentId}. COR field matching will be limited.`, { studentId });

			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because we could not retrieve your student information. Please ensure you have an account and try again.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}

		const normalizedText = this.normalizeText(extraction.fullText);

		const departmentCandidates = await this.getDepartmentCandidates();

		const extractedYearLevel = this.extractYearLevel(extraction.fullText);
		result.yearLevel = extractedYearLevel;

		const extractedSchoolYear = this.extractSchoolYear(extraction.fullText);
		if(!extractedSchoolYear) {
			logger.warn(`No school year found for student ID ${studentId}. COR field matching will be limited.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because no school year was found.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		result.schoolYear = extractedSchoolYear;

		const departmentMatch = await this.matchDepartment(normalizedText, departmentCandidates);
		if(!departmentMatch.matched) {
			logger.warn(`No department match found for student ID ${studentId}. COR field matching will be limited.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because no department match was found.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		result.department = departmentMatch.departmentName;
		result.program = departmentMatch.programName;
		result.programId = departmentMatch.programId;

		const nameMatched = this.matchExpectedName(normalizedText, studentInfo.user_name);
		if(!nameMatched) {
			logger.warn(`Expected name "${studentInfo.user_name}" did not match extracted text for student ID ${studentId}.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the expected name did not match the ones in your COR.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});
			return result;
		}
		result.nameMatched = nameMatched;

		const emailMatched = this.matchExpectedEmail(extraction.fullText, studentInfo.email);
		if(!emailMatched) {
			logger.warn(`Expected email "${studentInfo.email}" did not match extracted text for student ID ${studentId}.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the expected email did not match the ones in your COR.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});
			return result;
		}
		result.emailMatched = emailMatched;

		if (extractedSchoolYear && systemConfig) {
			logger.info(`Extracted school year ${extractedSchoolYear} vs current system config ${systemConfig.current_school_year}`);
		} else {
			logger.warn(`Could not extract school year or retrieve system config. Extracted: ${extractedSchoolYear}, System Config: ${systemConfig?.current_school_year}`);
		}

		const schoolYearMatched = extractedSchoolYear === systemConfig?.current_school_year;

		if(!schoolYearMatched) {
			logger.warn(`Extracted school year ${extractedSchoolYear} does not match current system config ${systemConfig?.current_school_year}`);
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the detected school year "${extractedSchoolYear ?? "N/A"}" does not match the current active school year for onboarding.\n\nPlease verify that you have submitted the correct COR for the current school year and try again.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		
		if (departmentMatch.matched && departmentMatch.programId && nameMatched && emailMatched && extractedSchoolYear && schoolYearMatched) {
			const yearLevelToUpdate = extractedYearLevel ?? "N/A";
			
			await this.studentRepository.updateStudentDepartmentById(studentId, departmentMatch.programId, yearLevelToUpdate, extractedSchoolYear);

			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed successfully",
				content: `Your submitted COR has been processed successfully.\n\nDetected department: ${departmentMatch.departmentName}\nProgram: ${departmentMatch.programName}\nYear level: ${yearLevelToUpdate}\nSchool year: ${extractedSchoolYear}.\n\nYou may now go back and log in to your account`,
				sendEmail: true,
				sendInApp: false,
				data: {
					department: departmentMatch.departmentName,
					program: departmentMatch.programName,
					yearLevel: yearLevelToUpdate,
					schoolYear: extractedSchoolYear,
					timestamp: new Date().toISOString(),
				},
			});

			return {
				department: departmentMatch.departmentName,
				program: departmentMatch.programName,
				programId: departmentMatch.programId,
				nameMatched: nameMatched,
				emailMatched: emailMatched,
				yearLevel: extractedYearLevel,
				schoolYear: extractedSchoolYear,
			};
		}

		await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
			userId: studentId,
			type: "system_alerts",
			title: "Certificate of registration for onboarding processed unsuccessfully",
			content: `Your submitted COR has been processed, but some fields could not be matched with the expected values.\n\nDetected department: ${departmentMatch.departmentName ?? "N/A"}\nProgram: ${departmentMatch.programName ?? "N/A"}\nYear level: ${extractedYearLevel ?? "N/A"}\nSchool year: ${extractedSchoolYear ?? "N/A"}\n\nPlease verify the detected information and contact support <heronwellnest@gmail.com> if you believe there is an error.`,
			sendEmail: true,
			sendInApp: false,
		});

		return result;

	}

	/**
	 * Extracts OCR text and matches configurable COR fields from a full GCS URI.
	 */
	public async extractCorDataFromPdfGcsUri(gcsUri: string, studentId: string): Promise<VisionCorMatchResult> {
		const extraction = await this.extractTextFromPdfGcsUri(gcsUri);
		
		const studentInfo = await this.studentRepository.findStudentInfoById(studentId);
		const systemConfig = await this.systemConfigRepository.RetrieveSystemConfig();

		const result : VisionCorMatchResult = {
			department: undefined,
			program: undefined,
			programId: undefined,
			nameMatched: false,
			emailMatched: false,
			yearLevel: undefined,
			schoolYear: undefined,
		}

		if (!studentInfo) {
			logger.warn(`Student info not found for ID ${studentId}. COR field matching will be limited.`, { studentId });

			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because we could not retrieve your student information. Please ensure you have an account and try again.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}

		const normalizedText = this.normalizeText(extraction.fullText);

		const departmentCandidates = await this.getDepartmentCandidates();

		const extractedYearLevel = this.extractYearLevel(extraction.fullText);
		result.yearLevel = extractedYearLevel;

		const extractedSchoolYear = this.extractSchoolYear(extraction.fullText);
		if(!extractedSchoolYear) {
			logger.warn(`No school year found for student ID ${studentId}. COR field matching will be limited.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because no school year was found.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		result.schoolYear = extractedSchoolYear;

		const departmentMatch = await this.matchDepartment(normalizedText, departmentCandidates);
		if(!departmentMatch.matched) {
			logger.warn(`No department match found for student ID ${studentId}. COR field matching will be limited.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because no department match was found.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		result.department = departmentMatch.departmentName;
		result.program = departmentMatch.programName;
		result.programId = departmentMatch.programId;

		const nameMatched = this.matchExpectedName(normalizedText, studentInfo.user_name);
		if(!nameMatched) {
			logger.warn(`Expected name "${studentInfo.user_name}" did not match extracted text for student ID ${studentId}.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the expected name did not match the ones in your COR.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});
			return result;
		}
		result.nameMatched = nameMatched;

		const emailMatched = this.matchExpectedEmail(extraction.fullText, studentInfo.email);
		if(!emailMatched) {
			logger.warn(`Expected email "${studentInfo.email}" did not match extracted text for student ID ${studentId}.`, { studentId });
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the expected email did not match the ones in your COR.\n\nPlease try again later.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});
			return result;
		}
		result.emailMatched = emailMatched;

		if (extractedSchoolYear && systemConfig) {
			logger.info(`Extracted school year ${extractedSchoolYear} vs current system config ${systemConfig.current_school_year}`);
		} else {
			logger.warn(`Could not extract school year or retrieve system config. Extracted: ${extractedSchoolYear}, System Config: ${systemConfig?.current_school_year}`);
		}

		const schoolYearMatched = extractedSchoolYear === systemConfig?.current_school_year;

		if(!schoolYearMatched) {
			logger.warn(`Extracted school year ${extractedSchoolYear} does not match current system config ${systemConfig?.current_school_year}`);
			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed unsuccessfully",
				content: `Your submitted COR has not been processed because the detected school year "${extractedSchoolYear ?? "N/A"}" does not match the current active school year for onboarding.\n\nPlease verify that you have submitted the correct COR for the current school year and try again.\n\nIf the issue persists, contact support <heronwellnest@gmail.com>.`,
				sendEmail: true,
				sendInApp: false,
			});

			return result;
		}
		
		if (departmentMatch.matched && departmentMatch.programId && nameMatched && emailMatched && extractedSchoolYear && schoolYearMatched) {
			const yearLevelToUpdate = extractedYearLevel ?? "N/A";
			
			await this.studentRepository.updateStudentDepartmentById(studentId, departmentMatch.programId, yearLevelToUpdate, extractedSchoolYear);

			await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
				userId: studentId,
				type: "system_alerts",
				title: "Certificate of registration for onboarding processed successfully",
				content: `Your submitted COR has been processed successfully.\n\nDetected department: ${departmentMatch.departmentName}\nProgram: ${departmentMatch.programName}\nYear level: ${yearLevelToUpdate}\nSchool year: ${extractedSchoolYear}.\n\nYou may now go back and log in to your account`,
				sendEmail: true,
				sendInApp: false,
				data: {
					department: departmentMatch.departmentName,
					program: departmentMatch.programName,
					yearLevel: yearLevelToUpdate,
					schoolYear: extractedSchoolYear,
					timestamp: new Date().toISOString(),
				},
			});

			return {
				department: departmentMatch.departmentName,
				program: departmentMatch.programName,
				programId: departmentMatch.programId,
				nameMatched: nameMatched,
				emailMatched: emailMatched,
				yearLevel: extractedYearLevel,
				schoolYear: extractedSchoolYear,
			};
		}

		await publishMessage(env.PUBSUB_NOTIFICATION_TOPIC, {
			userId: studentId,
			type: "system_alerts",
			title: "Certificate of registration for onboarding processed unsuccessfully",
			content: `Your submitted COR has been processed, but some fields could not be matched with the expected values.\n\nDetected department: ${departmentMatch.departmentName ?? "N/A"}\nProgram: ${departmentMatch.programName ?? "N/A"}\nYear level: ${extractedYearLevel ?? "N/A"}\nSchool year: ${extractedSchoolYear ?? "N/A"}\n\nPlease verify the detected information and contact support <heronwellnest@gmail.com> if you believe there is an error.`,
			sendEmail: true,
			sendInApp: false,
		});

		return result;

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
	 * Performs OCR text detection on a PDF file in Google Cloud Storage.
	 *
	 * @param gcsUri - Full GCS URI in the format `gs://bucket/path/to/file.pdf`.
	 * @returns A normalized OCR result containing full text and tokenized detections.
	 */
	public async extractTextFromPdfGcsUri(gcsUri: string): Promise<VisionTextExtractionResult> {
		const normalizedGcsUri = this.validateAndNormalizeGcsUri(gcsUri);

		try {
			const [result] = await visionClient.batchAnnotateFiles({
				requests: [
					{
						inputConfig: {
							gcsSource: { uri: normalizedGcsUri },
							mimeType: "application/pdf",
						},
						features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
					},
				],
			});

			const fileResponse = result.responses?.[0];
			const pageResponses = fileResponse?.responses ?? [];
			const fullText = pageResponses
				.map((page) => page.fullTextAnnotation?.text?.trim() ?? "")
				.filter((text) => text.length > 0)
				.join("\n");

			const annotations: EntityAnnotation[] = pageResponses.flatMap(
				(page) => page.textAnnotations ?? [],
			);

			logger.info("PDF OCR extracted text", {
				gcsUri: normalizedGcsUri,
				textLength: fullText.length,
				extractedText: fullText,
			});

			return {
				gcsUri: normalizedGcsUri,
				fullText: fullText,
				textDetections: annotations
					.map((annotation) => annotation.description?.trim() ?? "")
					.filter((text) => text.length > 0),
			};
		} catch (error) {
			logger.error(`Vision OCR failed for PDF ${normalizedGcsUri}.`, error);

			throw new AppError(
				502,
				"VISION_PDF_TEXT_DETECTION_FAILED",
				"Failed to extract text from PDF using Cloud Vision API",
				true,
			);
		}
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
	 * Convenience method to return only the full OCR text block for a GCS URI.
	 *
	 * @param gcsUri - Full GCS URI in the format `gs://bucket/path/to/file`.
	 * @returns The full detected text string (empty when no text is detected).
	 */
	public async extractFullTextFromPdfGcsUri(gcsUri: string): Promise<string> {
		const result = await this.extractTextFromPdfGcsUri(gcsUri);
		return result.fullText;
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

	private async getDepartmentCandidates(): Promise<CollegeDepartmentRow[]> {
		try {
			return await this.collegeDepartmentRepository.findAllActive();
		} catch (error) {
			logger.error("Failed to load college departments from database.", error);
			return [];
		}
	}

	private normalizeText(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private async matchDepartment(
		normalizedText: string,
		candidates: CollegeDepartmentRow[],
	): Promise<{ matched: boolean; departmentName?: string; programId?: string; programName?: string }> {

		for (const candidate of candidates) {
			const normalizedCandidate = this.normalizeText(candidate.department_name);

			if (normalizedCandidate && normalizedText.includes(normalizedCandidate)) {
				try {
					const programs = await this.collegeDepartmentRepository.findProgramsByDepartmentId(
						candidate.department_id,
					);

					// First pass: exact substring match
					for (const program of programs) {
						const normalizedProgram = this.normalizeText(program.program_name);
						if (normalizedProgram && normalizedText.includes(normalizedProgram)) {
							return {
								matched: true,
								departmentName: candidate.department_name,
								programId: program.program_id,
								programName: program.program_name,
							};
						}
					}

					// Second pass: token-based matching (similar to name matching)
					let bestProgramMatch: {
						programId: string;
						programName: string;
						matchedCount: number;
						tokenCount: number;
					} | null = null;

					for (const program of programs) {
						const normalizedProgram = this.normalizeText(program.program_name);
						const tokens = normalizedProgram.split(" ").filter((token) => token.length >= 2);
						
						if (tokens.length === 0) continue;

						const matchedCount = tokens.filter((token) => normalizedText.includes(token)).length;
						const requiredMatches = Math.max(1, Math.ceil(tokens.length * 0.6));

						if (matchedCount >= requiredMatches) {
							if (
								!bestProgramMatch ||
								matchedCount > bestProgramMatch.matchedCount ||
								(matchedCount === bestProgramMatch.matchedCount && tokens.length > bestProgramMatch.tokenCount)
							) {
								bestProgramMatch = {
									programId: program.program_id,
									programName: program.program_name,
									matchedCount,
									tokenCount: tokens.length,
								};
							}
						}
					}

					if (bestProgramMatch) {
						return {
							matched: true,
							departmentName: candidate.department_name,
							programId: bestProgramMatch.programId,
							programName: bestProgramMatch.programName,
						};
					}

					// Fallback: no match found, return first program
					if (programs.length > 0) {
						return {
							matched: true,
							departmentName: candidate.department_name,
							programId: programs[0].program_id,
							programName: programs[0].program_name,
						};
					}
				} catch (error) {
					logger.error(
						`Failed to fetch programs for department ${candidate.department_id}`,
						error,
					);
				}
			} else if (normalizedCandidate) {
				logger.info(`[DEBUG] ✗ Department "${normalizedCandidate}" NOT found in text`);
			}
		}

		logger.warn(`[DEBUG] No department matched after checking all ${candidates.length} candidates`);
		return { matched: false };
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
