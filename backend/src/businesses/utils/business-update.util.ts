import type { BusinessDocuments } from '../../database/schemas';
import type { UpdateBusinessDto } from '../dto/update-business.dto';
import type {
  BusinessUpdateFields,
  BusinessUpdateFiles,
  IncomingBusinessUpdateFile,
  StagedBusinessDocument,
} from '../types';

const UPDATABLE_FIELDS = [
  'displayName',
  'country',
  'city',
  'postalCode',
  'addressLine1',
  'addressLine2',
  'primaryContactNumber',
  'primaryContactEmail',
] as const;

/** Keeps only permitted fields; upper-cases the country and lower-cases the email. */
export function normalizeBusinessUpdate(dto: UpdateBusinessDto): {
  fields: BusinessUpdateFields;
} {
  const fields: BusinessUpdateFields = {};
  for (const key of UPDATABLE_FIELDS) {
    const value = dto[key];
    if (value !== undefined) fields[key] = value;
  }
  if (fields.country !== undefined) {
    fields.country = fields.country.toUpperCase();
  }
  if (fields.primaryContactEmail !== undefined) {
    fields.primaryContactEmail = fields.primaryContactEmail.toLowerCase();
  }
  return { fields };
}

/** Lists the uploaded documents with their destination inside `documents`. */
export function getIncomingFiles(
  files: BusinessUpdateFiles | undefined,
): IncomingBusinessUpdateFile[] {
  const entries = [
    ['panCard.frontImage', files?.panCardFront?.[0]],
    ['panCard.backImage', files?.panCardBack?.[0]],
    [
      'businessRegistrationCertificate',
      files?.businessRegistrationCertificate?.[0],
    ],
  ] as const;
  return entries.flatMap(([path, file]) => (file ? [{ path, file }] : []));
}

/** File ids of the documents that the staged uploads replace. */
export function replacedFileIds(
  documents: BusinessDocuments | null,
  staged: StagedBusinessDocument[],
): string[] {
  if (!documents) return [];
  return staged.flatMap(({ path }) => {
    const oldReference =
      path === 'panCard.frontImage'
        ? documents.panCard.frontImage
        : path === 'panCard.backImage'
          ? documents.panCard.backImage
          : documents.businessRegistrationCertificate;
    return oldReference?.fileId ? [oldReference.fileId] : [];
  });
}

/** True when all three documents have both a file id and a URL. */
export function hasCompleteDocuments(
  documents: BusinessDocuments | null,
): documents is BusinessDocuments {
  return Boolean(
    documents?.panCard?.frontImage?.fileId &&
    documents.panCard.frontImage.url &&
    documents.panCard.backImage?.fileId &&
    documents.panCard.backImage.url &&
    documents.businessRegistrationCertificate?.fileId &&
    documents.businessRegistrationCertificate.url,
  );
}
