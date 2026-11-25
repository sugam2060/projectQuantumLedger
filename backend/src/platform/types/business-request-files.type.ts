/** Multipart fields accepted by `POST /platform/businesses/request`. */
export type BusinessRequestFiles = {
  panCardFront?: Express.Multer.File[];
  panCardBack?: Express.Multer.File[];
  businessRegistrationCertificate?: Express.Multer.File[];
};

/** The three documents after the controller checked that each is present. */
export type BusinessRequestUploads = {
  panCardFront: Express.Multer.File;
  panCardBack: Express.Multer.File;
  businessRegistrationCertificate: Express.Multer.File;
};
