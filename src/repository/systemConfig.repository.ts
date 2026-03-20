import { AppDataSource } from "../config/datasource.config.js";

export type SystemConfigRow = {
  current_school_year: string;
}

/**
 * Repository for reading and updating System Configuration data.
 *
 * @description
 * Provides methods used by onboarding flows to fetch student information
 * and update their college department assignments.
 */
export class SystemConfigRepository {
  /**
   * Fetches a student's information by their ID.
   *
   * @param studentId - The UUID of the student
   * @returns The student's information, or null if not found
   */
  async RetrieveSystemConfig(configId = 1): Promise< SystemConfigRow | null> {
    const result = await AppDataSource.query(
      `
        SELECT current_school_year
        FROM system_configurations
        WHERE config_id = $1
      `,
      [configId]
    );

    return result.length > 0 ? result[0] : null;
  }

}