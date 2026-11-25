import type { business } from '../../database/schemas';

/** Response of `PATCH /businesses/:businessId` (also cached for idempotent replay). */
export type BusinessUpdateResponse = {
  businessId: string;
  updatedAt: string;
  changedFields: Record<string, unknown>;
};

/** Multipart document fields accepted by the business update route. */
export type BusinessUpdateFiles = {
  panCardFront?: Express.Multer.File[];
  panCardBack?: Express.Multer.File[];
  businessRegistrationCertificate?: Express.Multer.File[];
};

/** Profile fields an owner may change, after normalisation. */
export type BusinessUpdateFields = {
  displayName?: string;
  country?: string;
  city?: string;
  postalCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  primaryContactNumber?: string;
  primaryContactEmail?: string;
};

/** Where an uploaded document goes inside `business.documents`. */
export type BusinessDocumentPath =
  | 'panCard.frontImage'
  | 'panCard.backImage'
  | 'businessRegistrationCertificate';

export type IncomingBusinessUpdateFile = {
  path: BusinessDocumentPath;
  file: Express.Multer.File;
};

/** A document already uploaded to object storage, waiting for the DB commit. */
export type StagedBusinessDocument = {
  path: BusinessDocumentPath;
  object: {
    fileId: string;
    url: string;
    resourceType: string;
    format: string | null;
  };
};

export type BusinessAddress = NonNullable<
  typeof business.$inferSelect.addressDetails
>;
