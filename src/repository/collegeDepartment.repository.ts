import { AppDataSource } from "../config/datasource.config.js";

export type CollegeDepartmentRow = {
  department_id: string;
  department_name: string;
  is_deleted: boolean;
  created_at: Date;
  updated_at: Date;
};

/**
 * Repository for reading College Department reference data.
 *
 * @description
 * Provides methods used by OCR matching flows to fetch acceptable
 * department values from the database.
 */
export class CollegeDepartmentRepository {
  /**
   * Returns all non-deleted departments ordered by name.
   */
  async findAllActive(): Promise<CollegeDepartmentRow[]> {
    const rows = await AppDataSource.query(
      `
        SELECT department_id, department_name, is_deleted, created_at, updated_at
        FROM college_departments
        WHERE is_deleted = false
        ORDER BY department_name ASC
      `,
    );

    return rows as CollegeDepartmentRow[];
  }

  /**
   * Returns only the list of non-deleted department names.
   */
  async findAllActiveNames(): Promise<string[]> {
    const rows = await this.findAllActive();
    return rows.map((row) => row.department_name);
  }
}
