import { ImageAnnotatorClient } from '@google-cloud/vision';

/**
 * An instance of the Google Cloud Vision ImageAnnotatorClient used for OCR
 * and other image analysis operations within the application.
 *
 * @remarks
 * Ensure that Google Cloud credentials and project configuration are set
 * before using this client.
 *
 * @see {@link https://cloud.google.com/vision/docs/reference/libraries}
 */
const visionClient = new ImageAnnotatorClient();

export default visionClient;
