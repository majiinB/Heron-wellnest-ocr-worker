import { AppDataSource } from "../config/datasource.config.js";

export type StudentRow = {
  user_id: string;
  user_name: string;
  email: string;
}

/**
 * Repository for reading and updating Student data.
 *
 * @description
 * Provides methods used by onboarding flows to fetch student information
 * and update their college department assignments.
 */
export class StudentRepository {
  /**
   * Fetches a student's information by their ID.
   *
   * @param studentId - The UUID of the student
   * @returns The student's information, or null if not found
   */
  async findStudentInfoById(studentId: string): Promise<StudentRow | null> {
    const result = await AppDataSource.query(
      `
        SELECT user_id, user_name, email
        FROM "user"
        WHERE user_id = $1
      `,
      [studentId],
    );

    return result.length > 0 ? result[0] : null;
  }

  /**
   * Updates a student's college department assignment.
   *
   * @param studentId - The UUID of the student
   * @param departmentId - The department_id from college_departments table
   * @throws Will throw if the student is not found or department doesn't exist
   *
   * @description
   * Sets the student's program_id (foreign key) to reference a valid
   * college department. This is used during onboarding to assign verified
   * department information extracted from their COR (Certificate of Registration).
   * The department_id must exist in college_departments table.
   */
  async updateStudentDepartmentById(
    studentId: string,
    departmentId: string,
    yearLevel: string,
    corSchoolYear: string,
  ): Promise<void> {
    const result = await AppDataSource.query(
      `
        UPDATE student
        SET program_id = $1, cor_school_year = $2, year_level = $3, finished_onboarding = TRUE, updated_at = NOW()
        WHERE user_id = $4
      `,
      [departmentId, corSchoolYear, yearLevel, studentId],
    );

    // Optionally verify the update affected a row
    if (result.affected === 0) {
      throw new Error(`Student with id ${studentId} not found`);
    }
  }
}
